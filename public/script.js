const links = document.querySelectorAll("[data-bot-link]");
const toast = document.querySelector(".toast");

fetch("/api/site-config")
  .then((response) => response.json())
  .then(({ botUrl }) => {
    if (botUrl) {
      links.forEach((link) => {
        link.href = botUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
      return;
    }
    links.forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      toast.classList.add("show");
      window.setTimeout(() => toast.classList.remove("show"), 3200);
    }));
  });
