export type Atributo = { key: string; label: string; tipo: 'bool' | 'number' | 'select' | 'text'; unidade?: string; min?: number; max?: number; opcoes?: string[] };
export type TipoEquipamento = { id: string; nome: string; categoria: string; icone: string; orgao: string; movel: boolean; telemetria: string; criticidade: number; atributos: Atributo[] };
export type Situacao = { id: string; nome: string; cor: string; disponivel: boolean | null };
export type Bairro = { id: number; nome: string; zona: string; lat: number; lng: number; cep: string; ruas: string[]; poligono: [number, number][] };
export type TipoOcorrencia = { id: string; nome: string; foco: string; peso: number; duracaoMin: number };
export type StatusAgente = { id: string; nome: string; ativo: boolean; cor: string };

export type Meta = {
  cidade: { nome: string; uf: string; centro: { lat: number; lng: number }; bbox: { south: number; west: number; north: number; east: number }; pontos: { nome: string; lat: number; lng: number }[] };
  bairros: Bairro[];
  tiposEquipamento: TipoEquipamento[];
  situacoes: Situacao[];
  manutencaoTipos: { id: string; nome: string }[];
  orgaos: { id: string; nome: string }[];
  tiposAgente: { id: string; nome: string; orgao: string; foco: string }[];
  statusAgente: StatusAgente[];
  turnos: { id: string; nome: string }[];
  tiposOcorrencia: TipoOcorrencia[];
  zonas: string[];
  agora: number;
};

export type Equipamento = {
  id: number; tipo: string; serie: string; marca: string; modelo: string; orgao: string; cep: string; rua: string; referencia: string;
  bairro_id: number; bairro?: string; zona?: string; cidade: string; uf: string; lat: number; lng: number; situacao: string;
  manut_tipo: string; manut_data: number | null; manut_periodicidade_dias: number | null; instalado_em: number | null; ultima_manut: number | null;
  atributos: Record<string, any>; ultimo_sinal: number | null; criado_em: number; atualizado_em: number;
};

export type Agente = {
  id: number; nome: string; matricula: string; tipo: string; orgao: string; turno: string; status: string; telefone: string;
  bairro_id: number; bairro?: string; zona?: string; lat: number; lng: number; veiculo_id: number | null; veiculo_serie?: string; ocorrencia_id: number | null;
};

export type Ocorrencia = { id: number; tipo: string; bairro_id: number; bairro?: string; lat: number; lng: number; inicio: number; fim?: number | null; status: string; origem: string; agente_id?: number | null; agente?: string; exercicio?: number; descricao?: string };

export type Kpis = {
  total: number; operacionais: number; indisponiveis: number; nao_instalados: number; desativados: number; manut_urgente: number;
  operacionais_efetivos: number; sem_sinal: number; disponibilidade: number; agentes_ativos: number; agentes_em_ocorrencia: number; agentes_total: number;
  ocorrencias_abertas: number; ocorrencias_hoje: number; alertas_ativos: number;
};

export type EstadoVivo = {
  agora: number; kpis: Kpis;
  agentes: { id: number; lat: number; lng: number; status: string; tipo?: string; bairro_id: number; ocorrencia_id: number | null }[];
  moveis: { id: number; lat: number; lng: number }[];
  novasOcorrencias: Ocorrencia[]; ocorrenciasEncerradas: number[]; ocorrenciasAtualizadas?: { id: number; status: string }[]; equipamentosAlterados: number[]; semSinal: number[];
};

export type Alerta = { id: number; ts: number; nivel: 'critico' | 'alto' | 'medio' | 'info'; categoria: string; titulo: string; detalhe: string; bairro_id: number | null; lat?: number; lng?: number; reconhecido: boolean; ref?: { tipo: string; id: number; anomalia?: string } | null };

export type Regiao = {
  bairro_id: number; nome: string; zona: string; poligono: [number, number][]; estado: 'normal' | 'atencao' | 'critico'; motivos: string[];
  equipamentos: number; operacionais: number; disponibilidade: number; manutUrgente: number; ocorrenciasAbertas: number; graves: number; agentesAtivos: number;
  riscoAgora: number; pico6h: { hora: number; risco: number; desvio: number } | null;
};

export type Fator = { id: string; nome: string; mult: number };
export type TipoExplicado = { tipo: string; nome: string; esperado: number; prob: number; contribuicao: number };
export type Hotspot = { bairro_id: number; hora: number; risco: number; nivel: string; desvio: number; evento: string | null; chuvaMm: number; fatores: Fator[]; tipos: TipoExplicado[] };
export type Previsao = {
  geradoEm: number; horas: number;
  modelo: { treinadoAte: number; semanas: number; ocorrenciasUsadas: number; tempoTreinoMs: number; efeitoChuva: Record<string, number[]>; efeitoEvento: Record<string, number> };
  matriz: { bairro_id: number; serie: { hora: number; risco: number; desvio: number }[]; pico: { hora: number; risco: number; desvio: number }; esperado: number; nivelPico: string }[];
  curva: { hora: number; chuva: number; esperado: number; porTipo: Record<string, number> }[];
  hotspots: Hotspot[];
  eventos: { id: number; nome: string; local: string; bairro_id: number; inicio: number; fim: number; publico_estimado: number }[];
};
