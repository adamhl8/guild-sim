/**
 * The node adapter's built server entry, mapped in package.json `imports`. It only exists after `astro build`, and lint
 * runs before the build, so it is declared rather than resolved. Imported purely for its side effect: importing it
 * binds the HTTP listener.
 */
declare module "#astro-entry"
