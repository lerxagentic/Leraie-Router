const key = process.env.HERMES_CUSTOM_ROUTER_LERXA_NET_API_KEY || "";

async function probeCombo(modelName: string) {
  console.log(`\n================ Testing ${modelName} with Hermes context ================`);
  const res = await fetch("http://127.0.0.1:12800/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: "user",
          content: "hi kamu siapa?"
        }
      ],
      max_tokens: 300
    })
  });
  const data = await res.json();
  console.log("Model:", modelName);
  console.log("Reply:\n", data.choices?.[0]?.message?.content);
}

// Coba beberapa kali ke 'leraie-cina' (karena dia round_robin)
for (let i = 1; i <= 4; i++) {
  console.log(`--- Run ${i} ---`);
  await probeCombo("leraie-cina");
}

process.exit(0);
