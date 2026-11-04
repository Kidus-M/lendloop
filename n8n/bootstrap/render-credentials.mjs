// Prints n8n credentials built from the environment. Nothing here is written to
// the repository, and n8n encrypts these with N8N_ENCRYPTION_KEY on import.
const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const smtpUser = process.env.SMTP_USER ?? "";

const credentials = [
  {
    id: "lendloopHmacIn01",
    name: "LendLoop to n8n signing key",
    type: "crypto",
    data: { hmacSecret: requireEnv("LENDLOOP_TO_N8N_SECRET") },
  },
  {
    id: "lendloopHmacOut1",
    name: "n8n to LendLoop signing key",
    type: "crypto",
    data: { hmacSecret: requireEnv("N8N_TO_LENDLOOP_SECRET") },
  },
  {
    id: "lendloopSmtp0001",
    name: "LendLoop mail",
    type: "smtp",
    data: {
      host: process.env.SMTP_HOST ?? "mailpit",
      port: Number(process.env.SMTP_PORT ?? 1025),
      user: smtpUser,
      password: process.env.SMTP_PASSWORD ?? "",
      // Mailpit speaks plain SMTP on the private Docker network.
      secure: false,
      disableStartTls: smtpUser === "",
    },
  },
];

process.stdout.write(JSON.stringify(credentials));
