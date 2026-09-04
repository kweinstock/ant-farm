// SCAFFOLD NOTE (see docs/architecture.md):
// The real browser bootstrap is described in src/web/main.ts. When implementation
// starts, either repoint index.html to /src/web/main.ts or make this file a
// one-line re-export:  import "./web/main";
// Placeholder below is the original template code.

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  const p = document.createElement("p");
  p.textContent = "It works.";
  app.append(p);
}
