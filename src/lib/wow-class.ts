/**
 * Wowaudit sends Blizzard's canonical class names ("Death Knight", "Warlock"). The thirteen matching colours are
 * defined in `global.css`; an unrecognised class simply has no rule and inherits base-content, so a new expansion
 * cannot break a roster table.
 */
export const classColorClass = (wowClass: string): string => `class-${wowClass.toLowerCase().replaceAll(" ", "-")}`
