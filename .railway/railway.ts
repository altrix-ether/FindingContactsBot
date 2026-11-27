import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("web", {
    source: github("altrix-ether/FindingContactsBot", { branch: "main" }),
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    env: {
      NODE_ENV: "production",
      GITHUB_TOKEN: preserve(),
    },
  });

  return project("FindingContactsBot", {
    resources: [web],
  });
});
