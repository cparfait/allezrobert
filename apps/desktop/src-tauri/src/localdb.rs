//! Base locale SQLite du jeu (historique des sorties, FTP, records, séances perso) : un fichier
//! `profil/historique.sqlite` dans le dossier de données, pour jouer sans compte et garder tout
//! l'historique hors ligne. Le schéma et les requêtes vivent dans le TypeScript
//! (`apps/client/src/data/localDb.ts`) : le Rust n'expose qu'exécution, lecture et lot en
//! transaction, avec des paramètres liés (jamais de SQL construit avec des valeurs).

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json};

use crate::error::{io_error, AppResult};

static DB: Mutex<Option<Connection>> = Mutex::new(None);

/// Taille maximale d'une requête (protection contre une page qui enverrait n'importe quoi).
const MAX_SQL: usize = 64 * 1024;

fn db_path() -> PathBuf {
    crate::storage::data_dir().join("profil").join("historique.sqlite")
}

fn open() -> AppResult<Connection> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| io_error("Base locale", e))?;
    }
    let conn = Connection::open(&path).map_err(|e| io_error("Ouverture de la base locale", e))?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;")
        .map_err(|e| io_error("Base locale", e))?;
    Ok(conn)
}

/// Exécute `f` avec la connexion (ouverte à la demande).
fn with_db<T>(f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
    let mut guard = DB.lock().map_err(|_| "base locale verrouillée")?;
    if guard.is_none() {
        *guard = Some(open()?);
    }
    f(guard.as_mut().expect("connexion ouverte"))
}

/// Ferme la base (avant un déplacement du dossier de données) ; elle se rouvre à la prochaine requête.
pub fn close() {
    if let Ok(mut guard) = DB.lock() {
        *guard = None;
    }
}

fn to_value(v: &Json) -> AppResult<Value> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("nombre invalide")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        // Tableaux et objets : stockés en texte JSON.
        other => Value::Text(other.to_string()),
    })
}

fn to_json(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            Json::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

fn check_sql(sql: &str) -> AppResult<()> {
    if sql.len() > MAX_SQL {
        return Err("requête trop longue".into());
    }
    Ok(())
}

fn params(values: &[Json]) -> AppResult<Vec<Value>> {
    values.iter().map(to_value).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    changes: usize,
    last_insert_id: i64,
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

fn exec_on(conn: &Connection, sql: &str, values: &[Json]) -> AppResult<usize> {
    check_sql(sql)?;
    let p = params(values)?;
    if p.is_empty() && sql.contains(';') {
        // Script sans paramètre (migrations) : plusieurs instructions.
        conn.execute_batch(sql).map_err(|e| io_error("Base locale", e))?;
        return Ok(0);
    }
    conn.execute(sql, params_from_iter(p.iter())).map_err(|e| io_error("Base locale", e))
}

/// Exécute une instruction (INSERT, UPDATE, DELETE, CREATE…) ; renvoie lignes touchées et dernier identifiant.
#[tauri::command]
pub async fn localdb_execute(sql: String, params: Option<Vec<Json>>) -> AppResult<ExecResult> {
    tauri::async_runtime::spawn_blocking(move || {
        with_db(|conn| {
            let changes = exec_on(conn, &sql, params.as_deref().unwrap_or(&[]))?;
            Ok(ExecResult { changes, last_insert_id: conn.last_insert_rowid() })
        })
    })
    .await
    .map_err(|e| io_error("Base locale", e))?
}

/// Lecture : lignes sous forme d'objets (colonne → valeur).
#[tauri::command]
pub async fn localdb_query(sql: String, params: Option<Vec<Json>>) -> AppResult<Vec<Map<String, Json>>> {
    tauri::async_runtime::spawn_blocking(move || {
        with_db(|conn| {
            check_sql(&sql)?;
            let p = self::params(params.as_deref().unwrap_or(&[]))?;
            let mut stmt = conn.prepare_cached(&sql).map_err(|e| io_error("Base locale", e))?;
            let names: Vec<String> = stmt.column_names().iter().map(|s| (*s).to_owned()).collect();
            let mut rows = stmt.query(params_from_iter(p.iter())).map_err(|e| io_error("Base locale", e))?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().map_err(|e| io_error("Base locale", e))? {
                let mut obj = Map::with_capacity(names.len());
                for (i, name) in names.iter().enumerate() {
                    obj.insert(name.clone(), to_json(row.get_ref(i).map_err(|e| io_error("Base locale", e))?));
                }
                out.push(obj);
            }
            Ok(out)
        })
    })
    .await
    .map_err(|e| io_error("Base locale", e))?
}

/// Plusieurs instructions dans une transaction (tout ou rien) ; renvoie les lignes touchées par chacune.
#[tauri::command]
pub async fn localdb_batch(statements: Vec<Statement>) -> AppResult<Vec<usize>> {
    tauri::async_runtime::spawn_blocking(move || {
        with_db(|conn| {
            let tx = conn.transaction().map_err(|e| io_error("Base locale", e))?;
            let mut out = Vec::with_capacity(statements.len());
            for st in &statements {
                out.push(exec_on(&tx, &st.sql, &st.params)?);
            }
            tx.commit().map_err(|e| io_error("Base locale", e))?;
            Ok(out)
        })
    })
    .await
    .map_err(|e| io_error("Base locale", e))?
}

/// Emplacement du fichier (Réglages → stockage, rapport de bug).
#[tauri::command]
pub fn localdb_path() -> String {
    db_path().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions_json() {
        assert_eq!(to_value(&Json::Bool(true)).unwrap(), Value::Integer(1));
        assert_eq!(to_value(&serde_json::json!(2.5)).unwrap(), Value::Real(2.5));
        assert_eq!(to_value(&serde_json::json!([1, 2])).unwrap(), Value::Text("[1,2]".into()));
        assert_eq!(to_json(ValueRef::Integer(7)), serde_json::json!(7));
        assert_eq!(to_json(ValueRef::Text(b"a")), serde_json::json!("a"));
    }

    #[test]
    fn execution_et_transaction() {
        let mut conn = Connection::open_in_memory().unwrap();
        exec_on(&conn, "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE INDEX t_v ON t (v);", &[]).unwrap();
        assert_eq!(exec_on(&conn, "INSERT INTO t (v) VALUES (?1)", &[serde_json::json!("x")]).unwrap(), 1);
        let tx = conn.transaction().unwrap();
        exec_on(&tx, "INSERT INTO t (v) VALUES (?1)", &[serde_json::json!("y")]).unwrap();
        assert!(exec_on(&tx, "INSERT INTO pas_de_table VALUES (1)", &[]).is_err());
        drop(tx); // annulée
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
