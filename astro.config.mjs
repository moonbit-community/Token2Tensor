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

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'Token 2 Tensor',
      customCss: [
        './src/tailwind.css',
      ],
      social: {
        github: 'https://github.com/moonbitlang/MiniMoonBit2025',
      },
      sidebar: [
        {
          label: 'Token 2 Tensor',
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
