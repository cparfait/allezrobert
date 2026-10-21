/**
 * Envoi des liens magiques par SMTP (nodemailer). Sans SMTP_URL, en développement, le lien
 * est écrit dans le journal du serveur ; en production la connexion par e-mail est désactivée.
 */
import nodemailer from 'nodemailer';

export interface Mailer {
  readonly enabled: boolean;
  sendMagicLink(to: string, link: string, locale: 'fr' | 'en'): Promise<void>;
}

export function createMailer(smtpUrl: string | undefined, from: string, production: boolean, log: (m: string) => void = console.log): Mailer {
  if (!smtpUrl) {
    return {
      enabled: !production,
      async sendMagicLink(_to, link) {
        if (production) throw new Error('SMTP non configuré');
        log(`[mail:dev] lien magique : ${link}`);
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    enabled: true,
    async sendMagicLink(to, link, locale) {
      const fr = locale !== 'en';
      await transport.sendMail({
        from,
        to,
        subject: fr ? 'Ton lien de connexion — Allez Robert !' : 'Your sign-in link — Allez Robert!',
        text: fr
          ? `Bonjour,\n\nClique sur ce lien pour te connecter à Allez Robert ! (valable 15 minutes, une seule fois) :\n\n${link}\n\nSi tu n'as rien demandé, ignore ce message.`
          : `Hello,\n\nClick this link to sign in to Allez Robert! (valid for 15 minutes, single use):\n\n${link}\n\nIf you did not ask for it, ignore this message.`,
        html: `<p>${fr ? 'Clique sur ce lien pour te connecter à <b>Allez Robert !</b> (valable 15 minutes, une seule fois) :' : 'Click this link to sign in to <b>Allez Robert!</b> (valid for 15 minutes, single use):'}</p><p><a href="${link}">${fr ? 'Me connecter' : 'Sign in'}</a></p>`,
      });
    },
  };
}
