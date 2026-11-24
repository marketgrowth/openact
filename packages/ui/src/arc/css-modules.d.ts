// Types for the CSS modules that Arc components import. Vite builds them.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
