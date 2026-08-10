import { describe, expect, it } from 'vitest';
import { isRecoverableDomMutationError } from '@/components/dom-integrity-guard';
import { localeDirection } from '@/lib/hooks/use-i18n';

describe('DOM integrity protection', () => {
  it('recognizes React placement failures caused by an externally mutated DOM', () => {
    expect(
      isRecoverableDomMutationError({
        name: 'NotFoundError',
        message:
          "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
      }),
    ).toBe(true);
    expect(
      isRecoverableDomMutationError({
        name: 'NotFoundError',
        message:
          "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      }),
    ).toBe(true);
  });

  it('does not reload for unrelated application errors', () => {
    expect(
      isRecoverableDomMutationError({
        name: 'TypeError',
        message: 'Cannot read properties of undefined.',
      }),
    ).toBe(false);
    expect(
      isRecoverableDomMutationError({
        name: 'NotFoundError',
        message: 'A requested record was not found.',
      }),
    ).toBe(false);
  });

  it('keeps the document direction aligned with the selected locale', () => {
    expect(localeDirection('zh-CN')).toBe('ltr');
    expect(localeDirection('en-US')).toBe('ltr');
    expect(localeDirection('ar-SA')).toBe('rtl');
  });
});
