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

Codi checks for newer Harness versions in provider settings. If the CLI was installed globally
through a supported package manager, use the update action there to install the new version.
For a source checkout or other unrecognized installation, update it with the tool that installed it.

## Models

New threads start on **DeepSeek-V4-Flash**, the model DeepSeek Harness uses by default. Select
**DeepSeek-V4.1-Flash** or **DeepSeek-V4-Pro** in the model picker to use another model. For another model, add its ID
under **Custom models** in the instance settings. A model your account cannot use stops the turn
with an error.

The model picker also offers DeepSeek's **Off**, **Low**, **High**, and **Max** reasoning levels.

## Usage

The Usage page reads token counts from DeepSeek Harness sessions, including sessions run outside
Codi under the same `DSH_HOME`. DeepSeek appears in the token chart and Flow view when it has
usage. Cost uses Codi's model prices or a price you set in the Usage page; models without a known
price are shown as unpriced.

## Permission Modes

Select a permission mode in the composer. Codi starts DeepSeek Harness in read-only mode for
**Supervised**, workspace-write mode for **Auto-accept edits** or **Auto**, and danger-full-access
mode for **Full access**. DeepSeek asks before tool calls such as writes and commands, and Codi
answers by the thread's permission mode. See
[ACP permissions](./providers-acp.md#permissions-and-terminals).
