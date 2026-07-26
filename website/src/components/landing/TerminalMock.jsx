import React from "react";

export default function TerminalMock() {
  return (
    <img
      src={`${process.env.PUBLIC_URL}/demo.gif`}
      alt="DeepSeek Code terminal demo"
      data-testid="terminal-mock"
      className="block w-full max-w-[900px] h-auto mx-auto"
    />
  );
}
