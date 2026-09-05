/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as authEmailDelivery from "../authEmailDelivery.js";
import type * as authEmailTemplates from "../authEmailTemplates.js";
import type * as countPolicy from "../countPolicy.js";
import type * as counts from "../counts.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as profiles from "../profiles.js";
import type * as workos from "../workos.js";
import type * as workosAuth from "../workosAuth.js";
import type * as workosAuthConfig from "../workosAuthConfig.js";
import type * as workosAuthInternal from "../workosAuthInternal.js";
import type * as workosAuthOrchestration from "../workosAuthOrchestration.js";
import type * as workosAuthPolicy from "../workosAuthPolicy.js";
import type * as workosErrorPolicy from "../workosErrorPolicy.js";
import type * as workosGateway from "../workosGateway.js";
import type * as workosIdentity from "../workosIdentity.js";
import type * as workosIntentCrypto from "../workosIntentCrypto.js";
import type * as workosProfilePolicy from "../workosProfilePolicy.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  authEmailDelivery: typeof authEmailDelivery;
  authEmailTemplates: typeof authEmailTemplates;
  countPolicy: typeof countPolicy;
  counts: typeof counts;
  crons: typeof crons;
  http: typeof http;
  profiles: typeof profiles;
  workos: typeof workos;
  workosAuth: typeof workosAuth;
  workosAuthConfig: typeof workosAuthConfig;
  workosAuthInternal: typeof workosAuthInternal;
  workosAuthOrchestration: typeof workosAuthOrchestration;
  workosAuthPolicy: typeof workosAuthPolicy;
  workosErrorPolicy: typeof workosErrorPolicy;
  workosGateway: typeof workosGateway;
  workosIdentity: typeof workosIdentity;
  workosIntentCrypto: typeof workosIntentCrypto;
  workosProfilePolicy: typeof workosProfilePolicy;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
