import type { WritebackCommand } from '@openmaic/learning-protocol';

/**
 * The local automation allowlist is intentionally narrower than the protocol
 * allowlist. It can update an already receipted companion or synthesis index,
 * and only through hash-matched managed blocks. Creating a first note,
 * changing arbitrary files, snapshots, and every future operation still
 * require a visible manual confirmation.
 */
export function isAutomaticallyApplicableManagedUpdate(command: WritebackCommand): boolean {
  return (
    (command.operation === 'replaceManagedBlocks' ||
      command.operation === 'replaceSynthesisIndexBlocks') &&
    command.arguments.blocks.length > 0
  );
}
