/**
 * Pure integration contract. Keep dependency arrows one-way:
 *
 *   web / Obsidian plugin / workers -> learning-protocol -> nothing
 */
export * from './json.js';
export * from './archive.js';
export * from './version.js';
export * from './source.js';
export * from './events.js';
export * from './project.js';
export * from './source-upload-intent.js';
export * from './writeback.js';
export * from './validate.js';
