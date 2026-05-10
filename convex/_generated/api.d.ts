/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as action from "../action.js";
import type * as channels from "../channels.js";
import type * as files from "../files.js";
import type * as projects from "../projects.js";
import type * as renderJob from "../renderJob.js";
import type * as scenes from "../scenes.js";
import type * as statuslog from "../statuslog.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  action: typeof action;
  channels: typeof channels;
  files: typeof files;
  projects: typeof projects;
  renderJob: typeof renderJob;
  scenes: typeof scenes;
  statuslog: typeof statuslog;
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
