const app = document.querySelector<HTMLElement>("#app");

if (app) {
  const p = document.createElement("p");
  p.textContent = "It works.";
  app.append(p);
}
