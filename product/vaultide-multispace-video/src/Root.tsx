import "./index.css";
import { VaultideComposition } from "./Composition";
import { VaultideFirstUseComposition } from "./FirstUseComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <VaultideComposition />
      <VaultideFirstUseComposition />
    </>
  );
};
