"use client";

import { useLayoutEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Zap,
  Shield,
  BarChart3,
  Globe,
  Cpu,
  Layers,
  ArrowRight,
  Code2,
  Activity
} from "lucide-react";
import { ROUTES } from "@/constants/routes";

// Register GSAP plugins
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export default function FeaturesPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      // Hero text stagger reveal
      gsap.from(".hero-text", {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: "power4.out",
        stagger: 0.15
      });

      // Hero image subtle scale-in
      gsap.from(".hero-image", {
        scale: 1.08,
        opacity: 0,
        duration: 1.8,
        ease: "power2.out"
      });

      // Feature Cards — scroll-triggered stagger
      gsap.utils.toArray<HTMLElement>(".feature-card").forEach((card, i) => {
        gsap.from(card, {
          scrollTrigger: {
            trigger: card,
            start: "top 90%",
            toggleActions: "play none none none"
          },
          y: 50,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          delay: i * 0.08
        });
      });

      // Solutions section image wipe-in
      gsap.from(".solutions-image", {
        clipPath: "inset(0 100% 0 0)",
        duration: 1.4,
        ease: "power4.inOut",
        scrollTrigger: {
          trigger: ".solutions-section",
          start: "top 75%",
        }
      });

      // Solutions list items stagger
      gsap.from(".solution-item", {
        x: -30,
        opacity: 0,
        stagger: 0.15,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".solutions-list",
          start: "top 80%",
        }
      });

      // Floating decorative elements
      gsap.to(".floating", {
        y: 15,
        duration: 2.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 0.4
      });

      // CTA section reveal
      gsap.from(".cta-block", {
        y: 60,
        opacity: 0,
        scale: 0.97,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".cta-block",
          start: "top 85%"
        }
      });

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Hero Section */}
      <section ref={heroRef} className="relative h-[90vh] flex items-center justify-center pt-20 overflow-hidden">
        <div className="absolute inset-0 z-0 bg-background">
          <Image
            src="/features_hero_abstract_1774783130297.png"
            alt="GitScope Features Hero"
            fill
            sizes="100vw"
            className="hero-image object-cover opacity-40 dark:opacity-30 grayscale-[0.4] dark:grayscale-[0.2]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        </div>

        <div className="relative z-10 max-w-5xl px-6 text-center">
          <div className="hero-text inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-semibold mb-8">
            <Zap className="size-3" />
            <span>Next-Generation Telemetry</span>
          </div>
          <h1 className="hero-text text-5xl md:text-7xl font-heading font-black tracking-tight mb-6">
            Engineering Intelligence <br />
            <span className="text-primary italic">Without Boundaries</span>
          </h1>
          <p className="hero-text text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            GitScope transforms raw development data into actionable architectural insights.
            Deploy faster, optimize infrastructure, and lead with technical precision.
          </p>
          <div className="hero-text flex flex-wrap items-center justify-center gap-4">
            <Link
              href={ROUTES.signup}
              className="px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold hover:scale-105 transition-transform flex items-center gap-2 shadow-lg shadow-primary/20"
            >
              Start Free Trial
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="#capabilities"
              className="px-8 py-4 rounded-xl border border-border hover:bg-muted transition-colors font-semibold"
            >
              Explore Capabilities
            </Link>
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section id="capabilities" className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-6">
            <div className="max-w-xl">
              <h2 className="text-sm font-bold uppercase tracking-[0.3em] text-primary mb-4">Capabilities</h2>
              <h3 className="text-4xl md:text-5xl font-heading font-black tracking-tighter">
                The full spectrum of <br /> development telemetry.
              </h3>
            </div>
            <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
              Consolidate your entire engineering stack into a single, unified intelligence layer.
              No silos, no blind spots, just pure visibility.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <Cpu className="size-8 text-indigo-600 dark:text-indigo-400" />,
                title: "Infrastructure Gating",
                desc: "Monitor deployment impact on cloud spend and resource usage in real-time.",
                image: "/telemetry_data_viz_1774783192025.png"
              },
              {
                icon: <Layers className="size-8 text-cyan-600 dark:text-cyan-400" />,
                title: "Architecture Mapping",
                desc: "Deep-tree dependency analysis and automated service mesh visualization.",
                image: "/planet_git_landscape_1774716291875.png"
              },
              {
                icon: <Shield className="size-8 text-emerald-600 dark:text-emerald-400" />,
                title: "Predictive Security",
                desc: "Identify vulnerabilities and technical debt before they reach production.",
                image: "/high_tech_desk_1774716313889.png"
              }
            ].map((feature, i) => (
              <div key={i} className="feature-card group relative p-8 rounded-3xl border border-border bg-card hover:border-primary/30 hover:shadow-royal transition-all duration-500 overflow-hidden">
                <div className="relative z-10">
                  <div className="mb-6 p-3 rounded-2xl bg-muted/60 backdrop-blur-sm border border-border inline-block group-hover:scale-110 transition-transform duration-500">
                    {feature.icon}
                  </div>
                  <h4 className="text-xl font-bold mb-3">{feature.title}</h4>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                    {feature.desc}
                  </p>
                  <div className="relative h-48 rounded-2xl overflow-hidden border border-border bg-muted/20">
                    <Image
                      src={feature.image}
                      alt={feature.title}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-1000 opacity-90 dark:opacity-70"
                    />
                  </div>
                </div>
                {/* Background glow */}
                <div className="absolute -bottom-20 -right-20 size-64 bg-primary/5 blur-[100px] rounded-full group-hover:bg-primary/15 transition-colors" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions Section */}
      <section id="solutions" className="solutions-section py-24 bg-muted/30 dark:bg-muted/10 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="relative order-2 lg:order-1">
              <div className="absolute -inset-4 bg-primary/10 blur-[80px] rounded-full opacity-30" />
              <div className="solutions-image relative rounded-3xl border border-border overflow-hidden shadow-2xl bg-muted/10" style={{ clipPath: "inset(0 0 0 0)" }}>
                <Image
                  src="/telemetry_data_viz_1774783192025.png"
                  alt="GitScope Solutions"
                  width={800}
                  height={600}
                  className="w-full h-auto opacity-90 dark:opacity-80"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
                <div className="absolute bottom-6 left-6 right-6">
                  <div className="p-4 rounded-xl bg-background/80 backdrop-blur-md border border-border flex items-center gap-4">
                    <Activity className="size-6 text-primary shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Real-time Pulse</div>
                      <div className="text-xs font-medium">Cluster health: 99.98% • Latency: 12ms</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative Floating Elements */}
              <div className="floating absolute -top-8 -right-8 p-4 rounded-2xl bg-card backdrop-blur-md border border-border shadow-xl hidden md:block">
                <BarChart3 className="size-6 text-primary" />
              </div>
              <div className="floating absolute top-1/2 -left-12 p-4 rounded-2xl bg-card backdrop-blur-md border border-border shadow-xl hidden md:block">
                <Globe className="size-6 text-primary" />
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <h2 className="text-sm font-bold uppercase tracking-[0.3em] text-primary mb-4">Solutions</h2>
              <h3 className="text-4xl md:text-5xl font-heading font-black tracking-tighter mb-8 italic">
                Architected for the <br /> modern enterprise.
              </h3>

              <div className="solutions-list space-y-8">
                {[
                  {
                    title: "Platform Engineering",
                    desc: "Equip your platform team with internal developer portal (IDP) templates and automated infrastructure provisioning graphs."
                  },
                  {
                    title: "CTO Intelligence",
                    desc: "High-level DORA metrics and engineering velocity reports for executive decision-making."
                  },
                  {
                    title: "Incident Response",
                    desc: "Automatic code-base search and service mapping during critical outages to minimize MTTR."
                  }
                ].map((item, i) => (
                  <div key={i} className="solution-item flex gap-6 group">
                    <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                      {i + 1}
                    </div>
                    <div>
                      <h5 className="text-lg font-bold mb-1 group-hover:text-primary transition-colors">{item.title}</h5>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="cta-block max-w-5xl mx-auto rounded-[3rem] bg-gradient-to-br from-indigo-600 to-indigo-900 p-12 md:p-24 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-0 size-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)] from-white/20" />
          </div>
          <div className="relative z-10 max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-6xl font-heading font-black mb-8 tracking-tighter italic">
              Ready to scale your intelligence?
            </h2>
            <p className="text-indigo-100/80 text-lg mb-12 font-medium">
              Join 500+ high-growth engineering teams already mapping their future with GitScope.
            </p>
            <Link
              href={ROUTES.signup}
              className="px-10 py-5 rounded-2xl bg-white text-indigo-900 font-black text-lg hover:scale-105 transition-transform inline-flex items-center gap-3 shadow-2xl"
            >
              Get Started for Free
              <Code2 className="size-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
