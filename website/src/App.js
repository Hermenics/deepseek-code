import React from "react";
import useLenis from "./lib/useLenis";
import Header from "./components/landing/Header";
import Hero from "./components/landing/Hero";
import ChapterI from "./components/landing/ChapterI";
import ChapterII from "./components/landing/ChapterII";
import ChapterIII from "./components/landing/ChapterIII";
import Marquee from "./components/landing/Marquee";
import Quickstart from "./components/landing/Quickstart";
import Footer from "./components/landing/Footer";

export default function App() {
  useLenis();

  return (
    <main
      data-testid="landing-root"
      className="relative min-h-screen bg-void text-white antialiased selection:bg-neon-blue selection:text-white"
    >
      <Header />
      <Hero />
      <ChapterI />
      <ChapterII />
      <ChapterIII />
      <Marquee />
      <Quickstart />
      <Footer />
    </main>
  );
}
