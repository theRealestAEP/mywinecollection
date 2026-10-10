/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accessKeys from "../accessKeys.js";
import type * as auth from "../auth.js";
import type * as book from "../book.js";
import type * as cellars from "../cellars.js";
import type * as journal from "../journal.js";
import type * as keys from "../keys.js";
import type * as move from "../move.js";
import type * as sommelier from "../sommelier.js";
import type * as wild from "../wild.js";
import type * as wines from "../wines.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accessKeys: typeof accessKeys;
  auth: typeof auth;
  book: typeof book;
  cellars: typeof cellars;
  journal: typeof journal;
  keys: typeof keys;
  move: typeof move;
  sommelier: typeof sommelier;
  wild: typeof wild;
  wines: typeof wines;
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
