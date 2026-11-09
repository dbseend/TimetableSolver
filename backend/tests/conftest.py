import os

# Tests never reach a real LLM: env vars beat the repo .env (which may hold a real key).
# Tests that need an LLM inject a fake provider into app.state.llm.
os.environ["LLM_PROVIDER"] = "none"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""
