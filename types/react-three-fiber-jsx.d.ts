import type { ThreeElements } from '@react-three/fiber';

// React 19 with the automatic JSX runtime resolves intrinsic elements from the
// runtime modules. Keep the R3F element catalogue visible to Next's isolated
// type check so the WebGL knowledge-space primitives remain type-safe.
declare module 'react/jsx-runtime' {
  namespace JSX {
    // Module augmentation needs an interface here; ThreeElements supplies all members.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    // Module augmentation needs an interface here; ThreeElements supplies all members.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}
