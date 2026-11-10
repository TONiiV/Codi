# DeepSeek

Codi runs [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (`dsh`) as an agent,
using your DeepSeek account through its API key.

## Set Up DeepSeek

1. Install DeepSeek Harness (`dsh`) on the machine running the Codi server. See the
   [DeepSeek Harness repository](https://github.com/deepseek-ai/DeepSeek-Harness) for installation
   options.
2. Set `DEEPSEEK_API_KEY` in the DeepSeek provider's environment variables under
   **Settings → Providers**.
3. Enable DeepSeek and refresh it.

If `dsh` is not on the server's `PATH`, set its **Binary path**.

## Models

New threads start on DeepSeek's own default model. To run a specific model, add its ID under
**Custom models** in the instance settings; Codi sends it as the session's model. A model your
account cannot use stops the turn with an error.

## Permission Modes

DeepSeek asks before tool calls such as writes and commands, and Codi answers by the thread's
permission mode. See [ACP permissions](./providers-acp.md#permissions-and-terminals).
