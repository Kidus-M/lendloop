/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as crons from "../crons.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_automation from "../lib/automation.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_policies from "../lib/policies.js";
import type * as lib_signing from "../lib/signing.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_withdraw from "../lib/withdraw.js";
import type * as loans from "../loans.js";
import type * as maintenance from "../maintenance.js";
import type * as outbox from "../outbox.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  crons: typeof crons;
  "lib/audit": typeof lib_audit;
  "lib/automation": typeof lib_automation;
  "lib/availability": typeof lib_availability;
  "lib/domain": typeof lib_domain;
  "lib/errors": typeof lib_errors;
  "lib/events": typeof lib_events;
  "lib/functions": typeof lib_functions;
  "lib/policies": typeof lib_policies;
  "lib/signing": typeof lib_signing;
  "lib/text": typeof lib_text;
  "lib/validators": typeof lib_validators;
  "lib/withdraw": typeof lib_withdraw;
  loans: typeof loans;
  maintenance: typeof maintenance;
  outbox: typeof outbox;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
