// Déclarations des imports « bundler » utilisés par src/loaders.ts (Vite).
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}
