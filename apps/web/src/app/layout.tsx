import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Wisdom OS — 智慧决策引擎",
  description: "以《孙子兵法》为知识骨架，生成结构化可执行决策建议。",
};

const NAV = [
  { href: "/", label: "⌂", text: "首页" },
  { href: "/decision", label: "✦", text: "开始分析" },
  { href: "/knowledge", label: "册", text: "知识库" },
  { href: "/cases", label: "案", text: "案例" },
  { href: "/history", label: "时", text: "历史记录" },
  { href: "/account", label: "人", text: "帳號同步" },
  { href: "/settings", label: "⚙", text: "设置" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("wisdom_theme");if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full font-sans">
        {/* ==================== Mobile Bottom Nav ==================== */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-[#ded8cc] bg-[#fffdf9] md:hidden">
          {[...NAV.slice(0, 5), NAV.find((item) => item.href === "/account")!].map(({ href, label, text }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-[#77786f]"
            >
              <span className="text-base">{label}</span>
              <span>{text}</span>
            </Link>
          ))}
        </nav>

        {/* ==================== Desktop Sidebar ==================== */}
        <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-[#ded8cc] bg-[#fffdf9] p-6 md:flex">
          <Link href="/" className="mb-6 flex items-center gap-3 px-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#20221f] font-serif text-lg text-[#fffdf9]">
              谋
            </div>
            <div>
              <strong className="text-sm">决策智库</strong>
              <span className="mt-1 block text-[10px] text-[#77786f]">AI 智慧引擎</span>
            </div>
          </Link>

          <nav className="flex flex-col gap-1">
            {NAV.map(({ href, label, text }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[#77786f] hover:bg-[#eee9df] hover:text-[#20221f]"
              >
                <span className="w-6 text-center font-bold">{label}</span>
                <b className="font-medium">{text}</b>
              </Link>
            ))}
          </nav>

          <div className="mt-auto flex items-center gap-3 border-t border-[#ded8cc] px-2 pt-4">
            <div className="h-2 w-2 rounded-full bg-[#486451] shadow-[0_0_0_5px_rgba(72,100,81,0.15)]" />
            <div>
              <strong className="text-[11px]">本地智慧引擎</strong>
              <span className="mt-0.5 block text-[9px] text-[#77786f]">零 API 费用可运行</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
      </body>
    </html>
  );
}
