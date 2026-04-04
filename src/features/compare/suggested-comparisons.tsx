"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { SearchRepoResult } from "@/features/layout/top-nav";

interface SuggestedComparisonsProps {
  onSelect: (repo: SearchRepoResult) => void;
}

const SUGGESTED_PAIRS = [
  {
    title: "Frontend Frameworks",
    icon: "web",
    color: "from-blue-500 to-cyan-500",
    repos: [
      { owner: "facebook", repo: "react", avatar: "https://github.com/facebook.png", stars: "230k", desc: "A declarative, efficient, and flexible JavaScript library" },
      { owner: "vuejs", repo: "core", avatar: "https://github.com/vuejs.png", stars: "48k", desc: "The progressive JavaScript framework" },
      { owner: "sveltejs", repo: "svelte", avatar: "https://github.com/sveltejs.png", stars: "81k", desc: "Cybernetically enhanced web apps" },
    ],
  },
  {
    title: "Meta Frameworks",
    icon: "rocket_launch",
    color: "from-purple-500 to-pink-500",
    repos: [
      { owner: "vercel", repo: "next.js", avatar: "https://github.com/vercel.png", stars: "127k", desc: "The React Framework for the Web" },
      { owner: "nuxt", repo: "nuxt", avatar: "https://github.com/nuxt.png", stars: "55k", desc: "The Intuitive Vue Framework" },
      { owner: "sveltejs", repo: "kit", avatar: "https://github.com/sveltejs.png", stars: "18k", desc: "Web development, streamlined" },
    ],
  },
  {
    title: "CSS Frameworks",
    icon: "palette",
    color: "from-emerald-500 to-teal-500",
    repos: [
      { owner: "tailwindlabs", repo: "tailwindcss", avatar: "https://github.com/tailwindlabs.png", stars: "86k", desc: "A utility-first CSS framework" },
      { owner: "sass", repo: "sass", avatar: "https://github.com/sass.png", stars: "14k", desc: "Sass makes CSS fun again" },
      { owner: "unocss", repo: "unocss", avatar: "https://github.com/unocss.png", stars: "16k", desc: "The instant on-demand Atomic CSS engine" },
    ],
  },
  {
    title: "Backend Runtimes",
    icon: "terminal",
    color: "from-amber-500 to-orange-500",
    repos: [
      { owner: "nodejs", repo: "node", avatar: "https://github.com/nodejs.png", stars: "105k", desc: "JavaScript runtime built on Chrome's V8" },
      { owner: "denoland", repo: "deno", avatar: "https://github.com/denoland.png", stars: "98k", desc: "A modern runtime for JavaScript and TypeScript" },
      { owner: "oven-sh", repo: "bun", avatar: "https://github.com/oven-sh.png", stars: "76k", desc: "Incredibly fast JavaScript runtime" },
    ],
  },
  {
    title: "AI/ML Libraries",
    icon: "psychology",
    color: "from-rose-500 to-red-500",
    repos: [
      { owner: "tensorflow", repo: "tensorflow", avatar: "https://github.com/tensorflow.png", stars: "188k", desc: "An Open Source Machine Learning Framework" },
      { owner: "pytorch", repo: "pytorch", avatar: "https://github.com/pytorch.png", stars: "86k", desc: "Tensors and Dynamic neural networks" },
      { owner: "openai", repo: "openai-python", avatar: "https://github.com/openai.png", stars: "25k", desc: "The official Python library for OpenAI API" },
    ],
  },
  {
    title: "DevOps Tools",
    icon: "construction",
    color: "from-indigo-500 to-violet-500",
    repos: [
      { owner: "docker", repo: "moby", avatar: "https://github.com/docker.png", stars: "69k", desc: "The open-source application container engine" },
      { owner: "kubernetes", repo: "kubernetes", avatar: "https://github.com/kubernetes.png", stars: "113k", desc: "Production-Grade Container Orchestration" },
      { owner: "hashicorp", repo: "terraform", avatar: "https://github.com/hashicorp.png", stars: "44k", desc: "Automate infrastructure on any cloud" },
    ],
  },
];

export function SuggestedComparisons({ onSelect }: SuggestedComparisonsProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MaterialIcon name="lightbulb" size={20} className="text-amber-500" />
        <h3 className="text-sm font-bold text-foreground">Popular Comparison Categories</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SUGGESTED_PAIRS.map((category, idx) => (
          <motion.div
            key={category.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="group rounded-2xl border border-outline-variant/10 bg-surface-container/30 p-5 hover:bg-surface-container/60 transition-all duration-300"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`size-10 rounded-xl bg-gradient-to-br ${category.color} flex items-center justify-center`}>
                <MaterialIcon name={category.icon} size={20} className="text-white" />
              </div>
              <h4 className="font-bold text-sm">{category.title}</h4>
            </div>
            
            <div className="space-y-2">
              {category.repos.map((repo) => (
                <button
                  key={`${repo.owner}/${repo.repo}`}
                  onClick={() => onSelect(repo as SearchRepoResult)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-highest/50 transition-all text-left group/item"
                >
                  <img 
                    src={repo.avatar} 
                    alt="" 
                    className="size-8 rounded-lg group-hover/item:scale-110 transition-transform"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate">
                      <span className="opacity-40">{repo.owner}/</span>{repo.repo}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{repo.desc}</div>
                  </div>
                  <MaterialIcon 
                    name="add_circle" 
                    size={16} 
                    className="text-muted-foreground/30 group-hover/item:text-indigo-500 transition-colors" 
                  />
                </button>
              ))}
            </div>
            
            <div className="mt-4 pt-3 border-t border-outline-variant/10">
              <button
                onClick={() => {
                  category.repos.forEach((repo) => onSelect(repo as SearchRepoResult));
                }}
                className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500 hover:text-indigo-600 transition-colors"
              >
                Compare All Three →
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
