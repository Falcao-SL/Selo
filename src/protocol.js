/**
 * MCP por stdio: uma mensagem JSON por linha. Sem dependência.
 * Notificação (sem id) não recebe resposta.
 */

const FALLBACK_PROTOCOL = '2024-11-05';

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function formatToolError(err) {
  const message = err?.message || String(err);
  return err?.hint ? `${message}\nComo resolver: ${err.hint}` : message;
}

export async function handleMessage(message, { tools }) {
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
    return rpcError(message?.id ?? null, -32600, 'Mensagem inválida.');
  }

  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null;

  try {
    const result = await dispatch(method, params, tools);
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    return rpcError(id, err.code || -32603, err.message || 'Erro interno.');
  }
}

async function dispatch(method, params, tools) {
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return {
      protocolVersion: typeof requested === 'string' && requested ? requested : FALLBACK_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'selo', version: '0.1.0' },
      instructions:
        'Selo é o Mail.app deste Mac. Ele lista, busca, lê, baixa anexo, cria, responde, responde a todos, ' +
        'encaminha, envia, move, arquiva, exclui para a Lixeira, descadastra lista e aponta sinais de mensagem suspeita. ' +
        'Enviar, responder, encaminhar, excluir e descadastrar acontecem de verdade. ' +
        'Excluir vai para a Lixeira e dá para recuperar no Mail. check_message é uma heurística, não um antivírus.',
    };
  }

  if (method === 'ping') return {};

  if (method === 'tools/list') {
    return {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    };
  }

  if (method === 'tools/call') {
    const tool = tools.find((item) => item.name === params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Ferramenta desconhecida: "${params.name}". Use tools/list para ver o que o Selo faz.` }],
      };
    }
    try {
      const data = await tool.call(params.arguments || {});
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: formatToolError(err) }] };
    }
  }

  const error = new Error(`Método não suportado: ${method}`);
  error.code = -32601;
  throw error;
}
