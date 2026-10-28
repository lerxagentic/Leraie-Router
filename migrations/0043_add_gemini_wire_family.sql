-- Factory Droid serves Gemini's native generateContent protocol in addition to
-- OpenAI and Anthropic wires. PostgreSQL enums must be widened before rows with
-- wire_family='gemini' can be seeded.
ALTER TYPE "wire_family" ADD VALUE IF NOT EXISTS 'gemini';
