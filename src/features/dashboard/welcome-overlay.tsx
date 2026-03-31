"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function WelcomeOverlay() {
  const searchParams = useSearchParams();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (searchParams.get("welcome") === "true") {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        // Clean up URL without refreshing
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="flex flex-col items-center p-8 text-center"
          >
            <div className="mb-6 rounded-full bg-emerald-500/20 p-4 text-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight">Access Granted</h2>
            <p className="mt-2 text-muted-foreground font-medium">
              Initializing your secure GitScope session...
            </p>
            
            {/* Elegant scanline animation */}
            <div className="mt-8 h-1 w-48 overflow-hidden rounded-full bg-muted">
              <motion.div 
                className="h-full bg-emerald-500"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
