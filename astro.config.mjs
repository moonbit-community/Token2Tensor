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

// 根据环境区分本地开发和生产（GitHub Pages）配置
const isProd = process.env.NODE_ENV === 'production';

// https://astro.build/config
export default defineConfig({
  // 生产环境：GitHub Pages -> https://moonbit-community.github.io/Token2Tensor/
  // 开发环境：本地 dev -> http://localhost:4321/
  // 注意：site 在生产环境需要包含 base 路径，方便生成绝对链接
  site: isProd
    ? 'https://moonbit-community.github.io/Token2Tensor'
    : 'http://localhost:4321',
  base: isProd ? '/Token2Tensor' : '/',
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
