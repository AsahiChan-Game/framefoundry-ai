import type { Metadata } from "next";
import { FrameFoundryConsole } from "./framefoundry-console";

export const metadata: Metadata = {
  title: "帧造工场 · FrameFoundry AI",
  description: "面向中文创作者的本地 AI 视频生产控制台。",
};

export default function Home() {
  return <FrameFoundryConsole />;
}
