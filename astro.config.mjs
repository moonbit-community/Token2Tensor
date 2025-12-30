import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from "@astrojs/tailwind";
import rehypeMathjax from "rehype-mathjax";
import remarkMath from "remark-math";
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 Moonbit 语法定义
const moonbitGrammar = JSON.parse(
  fs.readFileSync(join(__dirname, 'src/moonbit-grammar.json'), 'utf-8')
);

// 根据环境区分本地开发、GitHub Pages 和 Vercel 的配置
const isProd = process.env.NODE_ENV === 'production';
const isVercel = !!process.env.VERCEL;

// https://astro.build/config
export default defineConfig({
  // 开发环境：本地 dev -> http://localhost:4321/
  // 生产环境：
  //   - GitHub Pages -> https://moonbit-community.github.io/Token2Tensor/ （有 base 前缀）
  //   - Vercel       -> https://token2tensor.ziyue.cafe/                 （无 base 前缀）
  // 注意：在 GitHub Pages 上，为了生成正确的绝对链接，site 需要包含 base 路径
  site: !isProd
    ? 'http://localhost:4321'
    : isVercel
      ? 'https://token2tensor.ziyue.cafe'
      : 'https://moonbit-community.github.io/Token2Tensor',
  base: !isProd
    ? '/'
    : isVercel
      ? '/'
      : '/Token2Tensor',
  output: 'static',

  integrations: [
    starlight({
      title: 'Build Your Own MoonBit Compier',
      customCss: [
        './src/tailwind.css',
      ],
      social: {
        github: 'https://github.com/moonbitlang/MiniMoonBit2025',
      },
      sidebar: [
        {
          label: 'Build Your Own MoonBit Compiler',
          autogenerate: {
            directory: 'Chapters',
          },
        }, 
      ]
    }),
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeMathjax],
    shikiConfig: {
      langs: [
        moonbitGrammar,
        // 如果需要可以添加其他自定义语言
      ],
      // 选择一个适合的主题
      theme: 'github-dark',
      // 或者使用多个主题
      // themes: {
      //   light: 'github-light',
      //   dark: 'github-dark',
      // },
    }
  }
});
