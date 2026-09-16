function renderApps() {
  const grid = document.getElementById("app-grid");

  APPS.filter((app) => app.enabled !== false).forEach((app) => {
    const card = document.createElement("a");
    card.className = "app-card";
    card.href = app.path;

    const icon = document.createElement("div");
    icon.className = "app-card-icon";
    icon.textContent = app.icon;

    const name = document.createElement("div");
    name.className = "app-card-name";
    name.textContent = app.name;

    const description = document.createElement("div");
    description.className = "app-card-description";
    description.textContent = app.description;

    card.append(icon, name, description);
    grid.appendChild(card);
  });
}

renderApps();
