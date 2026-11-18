// Vite turns an import ending in ?url into the URL of the built file.
declare module "*?url" {
  const url: string;
  export default url;
}
