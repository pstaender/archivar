declare module "*.css";
declare module "*.yml" {
  const content: Record<string, unknown>;
  export default content;
}
