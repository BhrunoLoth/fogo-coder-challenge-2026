'use strict';
/**
 * Catálogo do domínio do F.O.G.O.
 *
 * Decisão de arquitetura: cada tipo de equipamento declara um "schema" das suas
 * características particulares. O formulário do front é gerado a partir desse schema
 * e o back valida contra ele. Assim, adicionar um novo tipo de equipamento é
 * acrescentar um objeto aqui; nada de nova tabela, novo formulário ou nova rota.
 */

const SITUACOES = [
  { id: 'nao_instalado', nome: 'Ainda não instalado', cor: '#8a8f98', disponivel: null },
  { id: 'operacional', nome: 'Operacional', cor: '#3ecf8e', disponivel: true },
  { id: 'mau_funcionamento', nome: 'Mau funcionamento', cor: '#ffb020', disponivel: false },
  { id: 'manutencao', nome: 'Em manutenção', cor: '#4ea8ff', disponivel: false },
  { id: 'desativado', nome: 'Desativado', cor: '#5b6170', disponivel: null },
  { id: 'furtado', nome: 'Furtado / vandalizado', cor: '#ff4d4f', disponivel: false },
];

const MANUTENCAO_TIPOS = [
  { id: 'nenhuma', nome: 'Sem manutenção prevista' },
  { id: 'imediata', nome: 'Imediata (corretiva)' },
  { id: 'agendada', nome: 'Agendada' },
  { id: 'periodica', nome: 'Periódica (preventiva)' },
];

const ORGAOS = [
  { id: 'mobilidade', nome: 'Secretaria de Mobilidade Urbana' },
  { id: 'gcm', nome: 'Guarda Civil Municipal' },
  { id: 'pm', nome: 'Polícia Militar' },
  { id: 'der', nome: 'DER-SP (rodovias)' },
  { id: 'concessionaria', nome: 'Concessionária / operadora privada' },
  { id: 'defesa_civil', nome: 'Defesa Civil' },
];

const bool = (key, label) => ({ key, label, tipo: 'bool' });
const num = (key, label, unidade, min, max) => ({ key, label, tipo: 'number', unidade, min, max });
const sel = (key, label, opcoes) => ({ key, label, tipo: 'select', opcoes });
const txt = (key, label) => ({ key, label, tipo: 'text' });

/**
 * categoria: agrupa ícones no mapa.
 * movel: possui GPS e se movimenta (posição atualizada pela telemetria).
 * telemetria: métrica principal que o equipamento envia ao PROMETHEUS.
 */
const TIPOS_EQUIPAMENTO = [
  {
    id: 'radar', nome: 'Radar de fiscalização', categoria: 'fiscalizacao', icone: 'radar', orgao: 'mobilidade',
    movel: false, telemetria: 'veículos/min', criticidade: 3,
    atributos: [
      sel('modalidade', 'Modalidade', ['Velocidade', 'Avanço de semáforo', 'Conversão proibida', 'Retorno proibido', 'Faixa exclusiva']),
      num('velocidade_maxima', 'Velocidade máxima fiscalizada', 'km/h', 20, 120),
      num('faixas', 'Faixas monitoradas', '', 1, 6),
      bool('leitura_placa', 'Leitura de placas (OCR)'),
    ],
  },
  {
    id: 'camera', nome: 'Câmera de videomonitoramento', categoria: 'vigilancia', icone: 'camera', orgao: 'gcm',
    movel: false, telemetria: 'quadros/s', criticidade: 3,
    atributos: [
      bool('visao_noturna', 'Visão noturna'),
      sel('resolucao', 'Resolução de captura', ['720p', '1080p', '2K', '4K']),
      bool('colorida', 'Imagem colorida'),
      bool('ptz', 'Movimentação PTZ (gira/zoom)'),
      bool('analitico', 'Analítico de vídeo embarcado'),
    ],
  },
  {
    id: 'semaforo', nome: 'Controlador semafórico', categoria: 'trafego', icone: 'semaforo', orgao: 'mobilidade',
    movel: false, telemetria: 'ciclos/min', criticidade: 3,
    atributos: [
      num('fases', 'Fases', '', 2, 8),
      bool('onda_verde', 'Sincronizado (onda verde)'),
      bool('nobreak', 'Nobreak'),
      bool('botoeira', 'Botoeira para pedestres'),
    ],
  },
  {
    id: 'balanca', nome: 'Balança de caminhão', categoria: 'fiscalizacao', icone: 'balanca', orgao: 'der',
    movel: false, telemetria: 'pesagens/h', criticidade: 2,
    atributos: [
      sel('tipo_pesagem', 'Tipo de pesagem', ['Dinâmica (em movimento)', 'Estática']),
      num('capacidade_t', 'Capacidade', 't', 10, 120),
    ],
  },
  {
    id: 'fiscal_autonomo', nome: 'Veículo autônomo de fiscalização (rotativo)', categoria: 'estacionamento', icone: 'fiscal', orgao: 'mobilidade',
    movel: true, telemetria: 'placas lidas/h', criticidade: 2,
    atributos: [
      num('autonomia_km', 'Autonomia', 'km', 20, 400),
      bool('ocr_placas', 'Leitura automática de placas'),
      num('cameras', 'Câmeras embarcadas', '', 1, 8),
    ],
  },
  {
    id: 'cancela', nome: 'Cancela automatizada', categoria: 'estacionamento', icone: 'cancela', orgao: 'mobilidade',
    movel: false, telemetria: 'aberturas/h', criticidade: 1,
    atributos: [
      sel('acesso', 'Forma de acesso', ['Ticket', 'Tag', 'Leitura de placa', 'QR Code']),
      txt('local_atendido', 'Local atendido'),
    ],
  },
  {
    id: 'totem', nome: 'Totem de autoatendimento (rotativo)', categoria: 'estacionamento', icone: 'totem', orgao: 'mobilidade',
    movel: false, telemetria: 'transações/h', criticidade: 1,
    atributos: [
      bool('pix', 'Aceita Pix'), bool('cartao', 'Aceita cartão'), bool('dinheiro', 'Aceita dinheiro'),
      num('vagas_atendidas', 'Vagas atendidas', '', 5, 200),
    ],
  },
  {
    id: 'taxi', nome: 'Táxi', categoria: 'transporte', icone: 'taxi', orgao: 'mobilidade',
    movel: true, telemetria: 'corridas/dia', criticidade: 1,
    atributos: [txt('placa', 'Placa'), txt('permissionario', 'Permissionário'), num('capacidade', 'Passageiros', '', 1, 7), bool('acessivel', 'Acessível (cadeirante)')],
  },
  {
    id: 'mototaxi', nome: 'Mototáxi', categoria: 'transporte', icone: 'mototaxi', orgao: 'mobilidade',
    movel: true, telemetria: 'corridas/dia', criticidade: 1,
    atributos: [txt('placa', 'Placa'), txt('permissionario', 'Permissionário'), num('cilindrada', 'Cilindrada', 'cc', 100, 500)],
  },
  {
    id: 'escolar', nome: 'Transporte escolar', categoria: 'transporte', icone: 'escolar', orgao: 'mobilidade',
    movel: true, telemetria: 'alunos/dia', criticidade: 2,
    atributos: [txt('placa', 'Placa'), num('capacidade', 'Capacidade de alunos', '', 4, 50), bool('monitor', 'Possui monitor(a)'), txt('escola', 'Escola atendida')],
  },
  {
    id: 'patinete', nome: 'Patinete elétrico', categoria: 'micromobilidade', icone: 'patinete', orgao: 'concessionaria',
    movel: true, telemetria: 'bateria %', criticidade: 1,
    atributos: [
      sel('modalidade', 'Modalidade', ['Público', 'Compartilhado']),
      txt('operadora', 'Operadora'),
      num('velocidade_max', 'Velocidade máxima', 'km/h', 6, 32),
      num('bateria', 'Bateria', '%', 0, 100),
    ],
  },
  {
    id: 'moto_agente', nome: 'Moto de agente de trânsito', categoria: 'frota', icone: 'moto', orgao: 'mobilidade',
    movel: true, telemetria: 'km rodados', criticidade: 2,
    atributos: [txt('placa', 'Placa'), num('cilindrada', 'Cilindrada', 'cc', 150, 1000), bool('giroflex', 'Giroflex/sirene')],
  },
  {
    id: 'viatura_gcm', nome: 'Viatura da Guarda Municipal', categoria: 'frota', icone: 'viatura', orgao: 'gcm',
    movel: true, telemetria: 'km rodados', criticidade: 2,
    atributos: [txt('placa', 'Placa'), sel('modelo_viatura', 'Tipo', ['Sedan', 'SUV', 'Caminhonete', 'Moto']), bool('camera_embarcada', 'Câmera embarcada'), bool('radio_digital', 'Rádio digital')],
  },
  {
    id: 'viatura_pm', nome: 'Viatura da Polícia Militar', categoria: 'frota', icone: 'viatura', orgao: 'pm',
    movel: true, telemetria: 'km rodados', criticidade: 2,
    atributos: [txt('placa', 'Placa'), sel('modelo_viatura', 'Tipo', ['Sedan', 'SUV', 'Caminhonete', 'Moto']), bool('camera_embarcada', 'Câmera embarcada'), bool('radio_digital', 'Rádio digital')],
  },
  {
    id: 'sensor_alagamento', nome: 'Sensor de nível (alagamento)', categoria: 'ambiental', icone: 'sensor', orgao: 'defesa_civil',
    movel: false, telemetria: 'nível (cm)', criticidade: 2,
    atributos: [num('nivel_alerta_cm', 'Nível de alerta', 'cm', 5, 100), bool('pluviometro', 'Pluviômetro integrado')],
  },
  {
    id: 'painel', nome: 'Painel de mensagem variável', categoria: 'trafego', icone: 'painel', orgao: 'mobilidade',
    movel: false, telemetria: 'mensagens/h', criticidade: 1,
    atributos: [sel('tecnologia', 'Tecnologia', ['LED monocromático', 'LED colorido']), num('linhas', 'Linhas de texto', '', 1, 6)],
  },
];

const TIPOS_AGENTE = [
  { id: 'agente_transito', nome: 'Agente de trânsito', orgao: 'mobilidade', foco: 'transito' },
  { id: 'guarda_municipal', nome: 'Guarda civil municipal', orgao: 'gcm', foco: 'seguranca' },
  { id: 'policial_militar', nome: 'Policial militar', orgao: 'pm', foco: 'seguranca' },
];

const STATUS_AGENTE = [
  { id: 'patrulha', nome: 'Em patrulha', ativo: true, cor: '#3ecf8e' },
  { id: 'ocorrencia', nome: 'Atendendo ocorrência', ativo: true, cor: '#ff7a1a' },
  { id: 'deslocamento', nome: 'Em deslocamento (reforço)', ativo: true, cor: '#ffd23f' },
  { id: 'base', nome: 'Na base', ativo: true, cor: '#4ea8ff' },
  { id: 'fora_turno', nome: 'Fora de turno', ativo: false, cor: '#5b6170' },
  { id: 'afastado', nome: 'Afastado', ativo: false, cor: '#8a8f98' },
];

const TURNOS = [
  { id: 'manha', nome: 'Manhã (06h–14h)', inicio: 6, fim: 14 },
  { id: 'tarde', nome: 'Tarde (14h–22h)', inicio: 14, fim: 22 },
  { id: 'noite', nome: 'Noite (22h–06h)', inicio: 22, fim: 6 },
];

/**
 * Tipos de ocorrência. "foco" define que tipo de agente atende.
 * "peso" é a gravidade usada no índice de risco (1 = leve, 3 = grave).
 */
const TIPOS_OCORRENCIA = [
  { id: 'acidente', nome: 'Acidente de trânsito', foco: 'transito', peso: 3, duracaoMin: 50 },
  { id: 'congestionamento', nome: 'Congestionamento severo', foco: 'transito', peso: 2, duracaoMin: 35 },
  { id: 'via_obstruida', nome: 'Via obstruída / veículo quebrado', foco: 'transito', peso: 1.5, duracaoMin: 30 },
  { id: 'estacionamento_irregular', nome: 'Estacionamento irregular', foco: 'transito', peso: 0.25, duracaoMin: 15 },
  { id: 'roubo_furto', nome: 'Roubo / furto', foco: 'seguranca', peso: 3, duracaoMin: 60 },
  { id: 'perturbacao', nome: 'Perturbação / briga', foco: 'seguranca', peso: 1.5, duracaoMin: 30 },
  { id: 'alagamento', nome: 'Alagamento de via', foco: 'transito', peso: 2.5, duracaoMin: 90 },
  { id: 'vandalismo_equipamento', nome: 'Vandalismo de equipamento', foco: 'seguranca', peso: 2, duracaoMin: 40 },
];

const ZONAS = ['Centro', 'Norte', 'Sul', 'Leste', 'Oeste'];

// Mapas sem protótipo: TIPO_EQ['constructor'] ou SITUACAO['toString'] não "existem".
const byId = (arr) => Object.assign(Object.create(null), Object.fromEntries(arr.map((x) => [x.id, x])));

module.exports = {
  SITUACOES, MANUTENCAO_TIPOS, ORGAOS, TIPOS_EQUIPAMENTO, TIPOS_AGENTE, STATUS_AGENTE,
  TURNOS, TIPOS_OCORRENCIA, ZONAS,
  SITUACAO: byId(SITUACOES), TIPO_EQ: byId(TIPOS_EQUIPAMENTO), TIPO_AG: byId(TIPOS_AGENTE),
  STATUS_AG: byId(STATUS_AGENTE), TIPO_OC: byId(TIPOS_OCORRENCIA), ORGAO: byId(ORGAOS),
};
