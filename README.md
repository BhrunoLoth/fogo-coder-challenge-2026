# F.O.G.O. – Ferramenta Onisciente de Gestão e Operações

Projeto da Etapa Bônus do **Coder Challenge 2026 (DSIN)**. É uma central de operações de trânsito e segurança para Marília/SP, dividida nas três partes do desafio: inventário dos equipamentos, central em tempo real e previsão.

Bhruno Santos · Análise e Desenvolvimento de Sistemas · FATEC Garça

## A ideia

O que mais me chamou atenção no Protocolo Prometheus foi o motivo de a IA ter assumido o controle: as pessoas usavam sistemas que não entendiam mais. Por isso decidi que o F.O.G.O. não teria nada de caixa-preta:

- cada previsão mostra de onde veio e quanto cada fator pesou;
- nenhuma recomendação é aplicada sem um operador aprovar;
- o próprio sistema mostra quanto acertou nos últimos dias.

O nome é uma referência ao fogo que Prometeu entregou aos humanos.

A outra decisão foi não deixar a cidade parada. Não existem dados públicos dos equipamentos de Marília, então criei um simulador. Ele gera 90 dias de histórico e, enquanto o sistema está aberto, continua gerando ocorrências, telemetria e movimentação dos agentes. A geografia é real: bairros, CEPs, avenidas e pontos de referência vieram do OpenStreetMap. Todo o resto é simulado.

## Como rodar

Só precisa do **Node.js 18 ou mais novo**. Não tem `npm install`: o servidor não usa nenhuma dependência externa e a interface já vai compilada na pasta `public/`.

- **Windows:** dois cliques no `iniciar.bat`
- **Linux/macOS:** `./iniciar.sh`
- **Qualquer sistema:** `npm start`

O navegador abre em http://localhost:3000. Se a porta estiver ocupada, ele tenta a 3001, 3002 e assim por diante.

- Na primeira execução a cidade é gerada em cerca de 1 segundo e fica salva em `data/fogo.sqlite`.
- Para apagar tudo e gerar de novo: `npm run reset`.
- Os testes do motor rodam com `npm test`.
- Sem internet o sistema funciona normalmente. Só o mapa de fundo não carrega.

## Por onde começar a testar

Se tiver poucos minutos, sugiro esta ordem:

1. **Central, máquina do tempo.** Clique em *Reproduzir*. Ela mostra a cidade de 24 h atrás, com o que aconteceu de verdade, até 24 h à frente, com o risco previsto.
2. **Modo exercício → Acidente de trânsito.** Clique numa avenida. O agente mais próximo é despachado e os radares perto do acidente passam a registrar menos carros. Em 1 a 3 minutos aparece o alerta de fluxo anormal na aba *Anomalias ao vivo*.
3. **Modo exercício → Furto de câmera.** O cadastro continua dizendo que a câmera está operacional. Como ela para de mandar sinal, o sistema percebe em poucos segundos e marca em vermelho.
4. **Modo exercício → Chuva forte.** O risco da cidade é recalculado e os bairros mais baixos (Cascata, Nova Marília, Alto Cafezal) sobem em risco de alagamento.
5. **Cidade Preditiva.** Clique em qualquer célula do mapa de calor para ver o porquê daquele risco. Tem um jogo do MAC programado no Bento de Abreu, e dá para ver o efeito dele no entorno do estádio.
6. **Aba Prova.** Para cada um dos últimos 7 dias, o modelo é treinado só com os dados anteriores àquele dia e comparado com o que aconteceu.
7. **Inventário.** Cadastre um equipamento. Os campos mudam conforme o tipo, o GPS é marcado clicando no mapa e o CEP preenche o bairro.

## Como resolvi cada parte

### 1. Inventário

São 16 tipos de equipamento: radar, câmera, semáforo, balança, veículo de fiscalização do rotativo, cancela, totem, táxi, mototáxi, escolar, patinete, moto de agente, viaturas da GCM e da PM, sensor de alagamento e painel de mensagens.

Cada tipo tem características próprias. Radar tem modalidade e velocidade máxima; câmera tem visão noturna, resolução e se é colorida. Em vez de fazer um formulário para cada tipo, cada um declara os próprios campos em `server/domain/catalog.js`. O formulário é montado a partir dessa lista, e o servidor valida usando a mesma lista. Para incluir um tipo novo, basta adicionar um item no catálogo.

**Localização:**
- CEP, rua, referência ("nº 181", "oposto ao 181", "KM 203", "S/N"), bairro, cidade/UF e GPS.
- O GPS é marcado com um clique no mapa, e o bairro é descoberto pela posição.
- A busca de CEP funciona sem internet, usando a base de bairros.

**Situação e manutenção:**
- Situação: não instalado, operacional, mau funcionamento, em manutenção, desativado ou furtado.
- Manutenção: imediata, agendada ou periódica, com data da próxima.
- As duas ficam com histórico.

Agentes de trânsito, guardas municipais e policiais têm cadastro próprio, com turno, status, bairro e veículo.

### 2. Central de Operações

**Mapa:**
- Mostra todos os equipamentos e agentes.
- De longe, os equipamentos aparecem como pontos coloridos, para o mapa não ficar poluído. Ao aproximar, viram ícones por tipo, com um anel na cor da situação.
- Equipamento com problema fica piscando.

**Indicadores e filtros:**
- No topo: equipamentos operacionais, indisponíveis, disponibilidade, manutenção urgente, agentes em atividade e ocorrências abertas.
- Filtros por tipo, situação, zona, bairro, órgão responsável e manutenção urgente.

**Visão por região:** dividi a cidade com um **diagrama de Voronoi**, em que cada ponto do mapa pertence ao bairro mais próximo. A região pode ser colorida pelo risco ou pela "saúde" (equipamentos funcionando, ocorrências graves, agentes presentes).

**Tempo real:** tudo atualiza sozinho via Server-Sent Events.

**Detecção de anomalias:**
- **Sem sinal:** cada equipamento manda um sinal a cada 30 s. Se ficar mais de 90 s sem mandar e o cadastro disser que está operacional, gera alerta.
- **Fluxo de veículos:** o fluxo de cada radar nos últimos 5 minutos é comparado com o movimento geral da cidade. Se um radar cai e os outros não, o problema provavelmente está naquela via.
- **Pico de ocorrências:** gera alerta quando um bairro tem, nas últimas 3 horas, mais ocorrências do que o modelo considera plausível (menos de 0,2% de chance de ser acaso).

### 3. Cidade Preditiva

A previsão usa um modelo de Poisson. A taxa esperada de cada tipo de ocorrência é uma multiplicação de fatores:

```
taxa = base do bairro × horário × dia da semana × chuva × evento × tendência × câmeras fora do ar
```

Escolhi esse formato porque cada fator vira uma explicação ("×1,60 por causa do jogo"), que é o que o enunciado pede. Todos os fatores são aprendidos com o histórico das últimas 8 semanas, e o modelo é retreinado a cada hora:

- a **base** usa Bayes empírico, para que um bairro com poucos dados não fique com uma previsão exagerada;
- o efeito da **chuva** e dos **eventos** é a razão entre o que aconteceu nessas situações e o que era esperado;
- a **tendência** compara os últimos 14 dias com o padrão.

Além do mapa de risco, a Cidade Preditiva tem:

- **Reforço de agentes:** os agentes livres são distribuídos em proporção ao risco das próximas 3 horas (método de Hamilton). Quem se desloca é escolhido pelo algoritmo Húngaro, que minimiza a distância total. O operador aprova ou descarta, e a decisão fica registrada.
- **Manutenção preditiva:** cada tipo de equipamento tem uma distribuição de Weibull ajustada com o histórico de manutenções. Com ela o sistema calcula a chance de falha nos próximos 30 dias e identifica marcas que falham mais que o normal.
- **Tendências:** disponibilidade, uso e bairros que estão mudando de comportamento. Só aparece o que é estatisticamente significativo.
- **Prova:** backtest dos últimos 7 dias, comparação com uma estimativa simples (média do bairro) e gráfico de calibração.

Um cuidado que tomei foi separar o simulador do motor. O simulador tem informações escondidas: o perfil de cada bairro, o efeito real da chuva, uma marca de câmera com defeito e um bairro com roubos em alta. O motor (`server/engine`) nunca lê esses arquivos, só o banco de dados. Então, quando ele descobre que a marca Vigiax falha mais ou que os roubos estão subindo no Castelo Branco, ele aprendeu isso pelos dados, como teria que fazer com dados reais.

## Tecnologias e estrutura

- **Servidor:** Node.js puro, sem framework e sem dependências.
- **Banco:** SQLite rodando em WebAssembly (sql.js, incluído em `server/vendor`), para não precisar instalar banco nenhum.
- **Interface:** React, TypeScript e Leaflet. Os gráficos são feitos direto em SVG.
- **Algoritmos:** previsão, Voronoi, Húngaro e Weibull foram implementados no próprio projeto.

```
fogo/
├─ iniciar.bat / iniciar.sh   inicia o sistema
├─ server/
│  ├─ index.js                servidor HTTP
│  ├─ api.js                  API REST e eventos em tempo real
│  ├─ db.js                   banco de dados
│  ├─ domain/                 tipos de equipamento, situações e validação
│  ├─ engine/                 motor: risco, manutenção e algoritmos
│  ├─ sim/                    simulador da cidade
│  ├─ data/marilia.json       bairros, CEPs e pontos de referência
│  └─ test/                   testes automatizados
├─ web/                       código-fonte da interface
└─ public/                    interface compilada
```

**Segurança:**
- Todas as consultas ao banco são parametrizadas.
- Toda entrada é validada: tipo, CEP da faixa de Marília, coordenadas dentro da cidade e datas.
- Textos digitados são tratados antes de aparecer no mapa.
- Toda alteração fica registrada na auditoria (tela Registro).

Para alterar a interface: entre em `web`, rode `npm install` e depois `npm run build`.

## Próximos passos

- Login com perfis de acesso (operador, gestor, equipe de manutenção).
- Receber telemetria real dos equipamentos (por exemplo, via MQTT).
- Calcular o tempo de deslocamento dos agentes pelas ruas, e não em linha reta.

## Uso de IA

Usei o Claude (Anthropic) como par de programação durante o desenvolvimento, na discussão de arquitetura e na escrita e revisão do código. O sistema em funcionamento não usa nenhuma IA externa: os modelos de previsão são estatística implementada no próprio código.

## Sobre os dados

- **Real:** a geografia, tirada do OpenStreetMap.
- **Simulado:** ocorrências, equipamentos, agentes e telemetria.
- **Fictício:** os perfis de ocorrência dos bairros e as marcas dos equipamentos. Eles não representam a realidade.
