import "node:process";
export const config = {
  port: Number(process.env.SERVER_PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "development-secret",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://syncbook:syncbook@localhost:5432/syncbook"
};
