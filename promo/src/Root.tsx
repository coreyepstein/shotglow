import { Composition } from "remotion";
import { ShotglowLaunch } from "./ShotglowLaunch";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShotglowLaunch"
      component={ShotglowLaunch}
      durationInFrames={750}
      fps={30}
      width={1080}
      height={1080}
    />
  );
};
