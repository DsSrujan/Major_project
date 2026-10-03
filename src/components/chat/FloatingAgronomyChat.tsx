import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Send, Bot, RefreshCw, User
} from "lucide-react";

import { sendChatMessage } from "../../lib/apiClient";
import type { ChatMessagePayload } from "../../lib/apiClient";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";

interface FloatingAgronomyChatProps {
  plotId?: string;
  cropName?: string;
  farmerName?: string;
  showToast?: (message: string, type?: "success" | "info" | "warning") => void;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isError?: boolean;
}

const QUICK_PROMPTS = [
  "Can I mix Urea with MOP fertilizer?",
  "Should I fertilize if rain is expected?",
  "How do I correct acidic soil pH?",
  "What is the best NPK application timing?",
];

export const FloatingAgronomyChat: React.FC<FloatingAgronomyChatProps> = ({
  plotId,
  cropName = "Oil Palm",
  farmerName,
  showToast,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content: `Hello ${farmerName ? farmerName : "Farmer"}! I am NutriPalm AI, your agronomic assistant for **${cropName}**.\n\nAsk me anything about fertilizer mixing safety, soil deficiencies, or weather-smart application timings!`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [isOpen, messages]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: DisplayMessage = {
      id: userMsgId,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Format history for backend API
    const historyPayload: ChatMessagePayload[] = messages
      .filter((m) => !m.isError)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    try {
      const response = await sendChatMessage({
        plot_id: plotId || "default-plot",
        message: query,
        crop: cropName,
        history: historyPayload,
      });

      if (response.success && response.response) {
        const assistantMsg: DisplayMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: response.response,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const rawError = response.pop_message || response.error;
        const sanitizedError = rawError
          ? rawError.replace(/Groq response failed:\s*/gi, "").replace(/Groq/gi, "AI Advisory")
          : "Agronomy advisory service temporarily unavailable. Please try again.";
        const errorMsg: DisplayMessage = {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ **Advisory Notice:**\n${sanitizedError}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);

        if (response.pop_message && showToast) {
          showToast(response.pop_message.replace(/Groq response failed:\s*/gi, "").replace(/Groq/gi, "AI Advisory"), "warning");
        }
      }
    } catch (err: any) {
      const errorMsg: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ **Connection Error:** Could not connect to the NutriPalm agronomy advisory service. Please check your connection or try again.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
      if (showToast) {
        showToast("Advisory service connection error. Please verify server status.", "warning");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: "assistant",
        content: `Chat history reset. How can I assist you with your **${cropName}** plot today?`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <>
      {/* Floating Action Trigger Button (Bottom-Right) */}
      <div className="fixed bottom-6 right-6 z-40">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsOpen(true)}
              className="group relative flex items-center gap-2.5 px-4 py-3.5 bg-linear-to-r from-emerald-600 via-emerald-700 to-green-800 text-white rounded-full shadow-xl shadow-emerald-750/30 hover:shadow-emerald-750/40 border border-white/20 cursor-pointer transition-all"
            >
              <span className="relative flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-300 rounded-full animate-ping" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-300 rounded-full" />
              </span>
              <span className="text-xs font-black tracking-wide hidden sm:inline">
                Agronomy AI Chat
              </span>
              <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full uppercase">
                {cropName}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Chat Modal Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-50 w-full sm:w-[420px] h-[550px] max-h-[85vh] bg-white rounded-3xl shadow-2xl border border-gray-200/80 flex flex-col overflow-hidden text-left"
          >
            {/* Header */}
            <div className="p-4 bg-linear-to-r from-emerald-700 via-emerald-800 to-green-900 text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-white/10 backdrop-blur-xs flex items-center justify-center border border-white/20">
                  <Bot className="w-5 h-5 text-emerald-200" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black tracking-tight leading-tight">
                      NutriPalm Agronomy AI
                    </h3>
                    <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                  </div>
                  <p className="text-[10px] text-emerald-100 font-medium">
                    Crop: <strong>{cropName}</strong> • Smart Agronomy Assistant
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleClearChat}
                  title="Clear chat history"
                  className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer border-0 text-[10px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer border-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gray-50/60 custom-scrollbar text-xs">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 items-start ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-white text-[10px] font-black ${
                      msg.role === "user"
                        ? "bg-slate-800"
                        : msg.isError
                        ? "bg-rose-600"
                        : "bg-emerald-600"
                    }`}
                  >
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[85%] rounded-2xl p-3.5 text-xs shadow-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-emerald-100/90 border border-emerald-300/80 text-gray-950 rounded-tr-xs font-semibold"
                        : msg.isError
                        ? "bg-rose-50 border border-rose-200 text-rose-900 rounded-tl-xs"
                        : "bg-white border border-gray-150 text-gray-800 rounded-tl-xs font-medium"
                    }`}
                    style={msg.role === "user" ? { color: "#09090b" } : undefined}
                  >
                    {msg.role === "assistant" && !msg.isError ? (
                      <MarkdownRenderer content={msg.content} variant="chat-assistant" />
                    ) : (
                      <div
                        className={`whitespace-pre-line break-words ${
                          msg.role === "user" ? "text-gray-950 font-bold" : "font-medium"
                        }`}
                        style={msg.role === "user" ? { color: "#09090b" } : undefined}
                      >
                        {msg.content}
                      </div>
                    )}
                    <span
                      className={`block text-[9px] mt-1.5 font-bold ${
                        msg.role === "user" ? "text-emerald-800/80 text-right" : "text-gray-400"
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              ))}

              {/* Typing / Loading Indicator */}
              {isLoading && (
                <div className="flex gap-2.5 items-center text-xs text-gray-500 font-semibold bg-white p-3 rounded-2xl border border-gray-150 w-fit">
                  <div className="w-4 h-4 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin shrink-0" />
                  <span className="text-[11px] text-gray-650">
                    Querying Knowledge Base & synthesizing advice...
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Chips */}
            <div className="px-3 py-2 bg-white border-t border-gray-100 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt)}
                  disabled={isLoading}
                  className="shrink-0 text-[10px] font-bold text-gray-700 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-800 border border-gray-200 hover:border-emerald-200 px-2.5 py-1 rounded-full transition-all cursor-pointer disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="p-3 bg-white border-t border-gray-150 flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${cropName}, fertilizer, or rain...`}
                disabled={isLoading}
                className="flex-1 bg-gray-50 border border-gray-250 text-xs font-semibold text-gray-900 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all placeholder:text-gray-400"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-0 shadow-xs shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
