"use client";

import { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type FeedbackCategory = "bug" | "feature" | "improvement" | "other";

export function FeedbackModal({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void 
}) {
  const [category, setCategory] = useState<FeedbackCategory>("improvement");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1500));
    setIsSubmitting(false);
    setIsSuccess(true);
    
    // Auto-close after success
    setTimeout(() => {
      onOpenChange(false);
      // Reset after animation
      setTimeout(() => {
        setIsSuccess(false);
        setMessage("");
      }, 500);
    }, 2000);
  };

  const categories: { id: FeedbackCategory, label: string, icon: string }[] = [
    { id: "bug", label: "Bug Report", icon: "bug_report" },
    { id: "feature", label: "New Feature", icon: "rocket_launch" },
    { id: "improvement", label: "Improvement", icon: "auto_awesome" },
    { id: "other", label: "Other", icon: "more_horiz" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border border-white/10 bg-slate-900/95 backdrop-blur-xl">
        <AnimatePresence mode="wait">
          {!isSuccess ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="p-6"
            >
              <DialogHeader className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="size-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                    <MaterialIcon name="chat_bubble" className="text-indigo-400" size={22} />
                  </div>
                  <div>
                    <DialogTitle className="text-xl font-bold tracking-tight text-white font-heading">
                      Help Us Evolve
                    </DialogTitle>
                    <DialogDescription className="text-slate-400 text-sm">
                      Your feedback directly shapes the future of GitScope.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">
                    Category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategory(c.id)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border text-sm font-semibold transition-all text-left",
                          category === c.id 
                            ? "bg-indigo-500/10 border-indigo-500/50 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.1)]" 
                            : "bg-slate-800/40 border-white/5 text-slate-400 hover:bg-slate-800/80 hover:border-white/10"
                        )}
                      >
                        <MaterialIcon name={c.icon} size={18} className={cn(category === c.id ? "text-indigo-400" : "text-slate-500")} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">
                    Your Insight
                  </label>
                  <Textarea
                    placeholder="Tell us what's on your mind..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[120px] bg-slate-800/40 border-white/5 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 rounded-xl text-white resize-none"
                  />
                </div>
              </div>

              <DialogFooter className="mt-8 border-t border-white/10 pt-6">
                <Button 
                  variant="ghost" 
                  onClick={() => onOpenChange(false)}
                  className="text-slate-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={isSubmitting || !message.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[120px] transition-all active:scale-[0.98]"
                >
                  {isSubmitting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="size-4 border-2 border-white/20 border-t-white rounded-full"
                    />
                  ) : "Ship Feedback"}
                </Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-12 text-center"
            >
              <div className="size-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <MaterialIcon name="verified" className="text-emerald-400" size={32} />
              </div>
              <h3 className="text-2xl font-heading font-black text-white mb-2 tracking-tight">Received!</h3>
              <p className="text-slate-400">Our engineering team has intercepted your transmission.</p>
              <p className="text-[10px] uppercase font-black tracking-widest text-emerald-400/50 mt-8">Transmitting Data... 100%</p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
// FeedbackModal v1
