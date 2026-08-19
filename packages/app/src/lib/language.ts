/**
 * The language spine's own interface is written in.
 *
 * A constant today because the copy is written into the components in Traditional Chinese
 * (#31 is the ticket for lifting it out). It exists as a named value all the same, because
 * one thing already reads it: the shelf's title collation follows the interface language
 * rather than `navigator.language`. A reader whose browser is set to en-US would otherwise
 * get a Chinese interface over a shelf sorted by code point, which is neither language's
 * answer. When #31 turns this into a setting, the shelf changes with it and nothing else
 * has to be found and fixed.
 */
export type UiLanguage = "zh-Hant";

export const UI_LANGUAGE: UiLanguage = "zh-Hant";
