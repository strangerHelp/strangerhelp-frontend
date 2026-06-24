import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  text: string;
  sender: "me" | "other";
  time: string;
  image?: string;
}

interface Props {
  matchId: string;
  userName: string;
}

export default function ChatWindow({ matchId, userName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  // TODO: Connect Socket.io here
  // const socket = io(SOCKET_URL); socket.emit("join", matchId);

  function send() {
    if (!input.trim()) return;
    const msg: Message = {
      id: Date.now().toString(),
      text: input.trim(),
      sender: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    // TODO: socket.emit("message", { matchId, ...msg });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-[var(--color-mute)] py-8">
            No messages yet. Say hello to {userName}!
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] px-3.5 py-2.5 rounded-lg text-sm ${
                msg.sender === "me"
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-br-none"
                  : "bg-[var(--color-canvas)] border border-[var(--color-hairline)] text-[var(--color-ink)] rounded-bl-none"
              }`}
            >
              <p>{msg.text}</p>
              <span className={`text-xs mt-1 block ${msg.sender === "me" ? "opacity-60" : "text-[var(--color-mute)]"}`}>{msg.time}</span>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-1 px-3.5 py-2.5 bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-lg rounded-bl-none w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-mute)] animate-bounce" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-mute)] animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-mute)] animate-bounce [animation-delay:300ms]" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--color-hairline)] bg-[var(--color-canvas)]">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 h-10 px-3 text-sm bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] rounded-md focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-mute)]"
          />
          <button
            type="submit"
            className="p-2 text-[var(--color-on-primary)] bg-[var(--color-primary)] rounded-md hover:opacity-90 transition-opacity"
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
}
