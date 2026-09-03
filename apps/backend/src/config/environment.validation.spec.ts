import { validateEnvironment } from "./environment.validation";

const base = {
  DATABASE_URL: "postgresql://ahkmes:password@localhost:5432/ahkmes",
  JWT_SECRET: "local-development-secret-at-least-32-characters",
  MINIO_ROOT_USER: "ahkmes",
  MINIO_ROOT_PASSWORD: "local-minio-password",
};

describe("validateEnvironment", () => {
  it("permits local development defaults", () => {
    expect(validateEnvironment(base).NODE_ENV).toBe("development");
  });

  it("rejects production placeholder secrets and unrestricted CORS", () => {
    expect(() => validateEnvironment({ ...base, NODE_ENV: "production", JWT_SECRET: "change-me-min-32-chars-random-string", CORS_ORIGINS: "*", PUBLIC_APP_URL: "https://api.example.test", PUBLIC_WEB_URL: "https://app.example.test" })).toThrow("Production JWT_SECRET");
  });

  it("accepts explicit production configuration", () => {
    const result = validateEnvironment({
      ...base,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://mes.example.test",
      PUBLIC_APP_URL: "https://api.example.test",
      PUBLIC_WEB_URL: "https://mes.example.test",
    });
    expect(result.BACKEND_PORT).toBe(3000);
  });
});
