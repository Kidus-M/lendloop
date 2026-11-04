import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const rawBuilderMessage =
  "Use the wrappers in convex/lib/functions.ts so every function declares its access level.";

const restrictRawBuilders = (name) => ({
  name,
  importNames: ["query", "mutation"],
  message: rawBuilderMessage,
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A forgotten auth check should fail lint, not wait for a reviewer to spot it.
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            restrictRawBuilders("./_generated/server"),
            restrictRawBuilders("../_generated/server"),
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
