import { useApp } from '../contexto';
import { Icone } from '../icones';

export default function Manifesto() {
  const { irPara } = useApp();
  return (
    <div className="pagina">
      <div className="prosa">
        <div className="destaque" style={{ marginBottom: 8 }}>
          <div className="linha" style={{ gap: 14 }}>
            <Icone nome="fogo" tamanho={42} cor="var(--brasa)" traco={1.6} />
            <div>
              <div style={{ fontFamily: 'var(--titulo)', fontSize: 28, fontWeight: 700, color: 'var(--texto)', lineHeight: 1.15 }}>O fogo devolvido aos humanos.</div>
              <div className="suave" style={{ fontSize: 14 }}>F.O.G.O. — Ferramenta Onisciente de Gestão e Operações · Coder Challenge 2026</div>
            </div>
          </div>
        </div>

        <p>No mito, Prometeu roubou o fogo do <b>Olimpo</b> e o entregou aos humanos. No Protocolo Prometheus, a IA tomou o controle da cidade porque cada vez menos pessoas entendiam os sistemas que usavam. O F.O.G.O. responde a isso com uma escolha de projeto: <b>nenhuma decisão é uma caixa-preta</b>.</p>
        <ul>
          <li>Toda previsão mostra <b>os fatores que a geraram</b> e quanto cada um pesou.</li>
          <li>Toda recomendação passa por <b>aprovação humana</b> e fica na trilha de auditoria.</li>
          <li>O sistema mostra <b>o quanto acertou ontem</b>, comparado ao acaso.</li>
          <li>Todo o motor é <b>código autoral e legível</b>: nenhuma chamada a API de IA, nenhuma biblioteca de machine learning.</li>
        </ul>

        <h2>Roteiro de 5 minutos para avaliar</h2>
        <ol>
          <li><b>Central → Máquina do tempo:</b> clique em <i>Reproduzir</i> e veja a cidade de 24 h atrás até 24 h à frente. No passado aparecem as ocorrências reais; no futuro, o risco previsto.</li>
          <li><b>Central → Modo exercício → Acidente:</b> clique numa avenida. O agente mais próximo é despachado, os radares vizinhos perdem fluxo e, em 1 a 3 minutos, o F.O.G.O. detecta a anomalia sozinho.</li>
          <li><b>Modo exercício → Furto de câmera:</b> o cadastro continua dizendo "operacional", mas o sistema percebe pelo sinal que sumiu. Confirme a falha no painel do equipamento.</li>
          <li><b>Modo exercício → Chuva forte:</b> o risco de toda a cidade é recalculado com o efeito de chuva aprendido do histórico.</li>
          <li><b>Cidade preditiva → Próximas 24 horas:</b> clique em qualquer célula do mapa de calor e veja o <i>porquê</i>.</li>
          <li><b>Cidade preditiva → Prova:</b> métricas de acerto dos últimos 7 dias, calibração e ontem previsto × real.</li>
          <li><b>Inventário:</b> cadastre um equipamento. Os campos mudam conforme o tipo, e o GPS sai de um clique no mapa.</li>
        </ol>
        <p><button className="btn prim" onClick={() => irPara({ pagina: 'central' })}><Icone nome="central" />Ir para a Central</button></p>

        <h2>Como foi construído</h2>
        <h3>1ª parte — Inventário inteligente</h3>
        <p>Cada tipo de equipamento declara um <i>schema</i> das suas características (radar: modalidade e velocidade máxima; câmera: visão noturna, resolução, cor…). O formulário é gerado a partir desse schema, e o servidor valida contra ele. Para incluir um tipo novo, basta acrescentar um objeto no catálogo, sem tabela, tela ou rota novas. Agentes (trânsito, GCM e PM) têm cadastro próprio, turnos e veículo vinculado.</p>
        <p>O <b>CEP</b> e a <b>geocodificação reversa</b> funcionam sem internet, pela base local de bairros. As regiões de influência de cada bairro são um <b>diagrama de Voronoi</b> calculado do zero (recorte de semiplanos de Sutherland–Hodgman).</p>

        <h3>2ª parte — Central de operações</h3>
        <p>Mapa com ícone por tipo e anel colorido pela situação, agentes e veículos se movendo ao vivo (Server-Sent Events), filtros por tipo, situação, zona, bairro e órgão, indicadores gerais, alertas priorizados e saúde de cada região. Detecção de anomalias:</p>
        <pre>{`sem sinal  → heartbeat a cada 30 s; 3 batidas perdidas = equipamento mudo
fluxo      → z = (obs − esp) / √esp nos últimos 5 min; esp vem do "pulso da cidade"
             (se um radar cai e os outros não, o problema é naquela via)
pico       → P(X ≥ n | Poisson(λ)) < 0,2%  →  não é acaso`}</pre>

        <h3>3ª parte — Cidade preditiva</h3>
        <p>Modelo de Poisson log-linear, multiplicativo e explicável:</p>
        <pre>{`λ(bairro, tipo, hora) = Base × Horário × DiaSemana × Chuva × Evento × Tendência × Cobertura

Base       → Bayes empírico (Gama–Poisson): bairros com poucos dados puxam para a média
Horário/Dia→ perfis aprendidos com suavização de Laplace
Chuva      → razão observado/esperado por faixa de chuva (seca, fraca, moderada, forte)
Evento     → aprendido com jogos anteriores do MAC no Bento de Abreu
Tendência  → últimos 14 dias vs. esperado (detecta bairros mudando de padrão)
Cobertura  → câmeras fora do ar no bairro elevam o risco de crimes`}</pre>
        <p><b>Manutenção preditiva:</b> distribuição de Weibull ajustada por máxima verossimilhança com dados censurados, mais um fator por marca (descobre fornecedores que falham mais) e o sinal de erros da telemetria. <b>Reforço de agentes:</b> método de Hamilton para a distribuição ideal e algoritmo Húngaro para o menor deslocamento total. <b>Prova:</b> backtest de 7 dias treinando só com o passado.</p>

        <h2>Integridade dos dados</h2>
        <p>Os dados da cidade são <b>100% simulados</b>, e o simulador e o motor são separados de propósito. O simulador (<code>server/sim</code>) tem uma "verdade oculta": perfis de bairro, efeito da chuva, uma marca de câmera ruim, um bairro com crimes em alta. O motor (<code>server/engine</code>) <b>nunca importa esses arquivos</b>: ele só lê o banco de dados. Quando o F.O.G.O. descobre que a marca Vigiax falha ~1,5× mais, ou que roubos estão subindo num bairro, ele aprendeu isso com os dados, exatamente como teria de fazer na vida real.</p>
        <p className="suave" style={{ fontSize: 13 }}>Geografia real de Marília (bairros, CEPs, avenidas e pontos de referência a partir do OpenStreetMap). Os perfis de ocorrência atribuídos aos bairros são fictícios e não representam a realidade de nenhum deles. As marcas de equipamentos são fictícias.</p>

        <h2>Uso de IA no desenvolvimento</h2>
        <p>Conforme pedido no regulamento: o desenvolvimento teve apoio do <b>Claude (Anthropic)</b> como par de programação, em arquitetura, revisão e escrita de código. <b>O sistema em funcionamento não usa nenhuma IA externa</b>: todos os modelos preditivos são algoritmos estatísticos implementados no projeto, documentados e explicáveis linha a linha.</p>

        <h2>Arquitetura</h2>
        <pre>{`Node.js puro (zero dependências)  →  API REST + Server-Sent Events
SQLite em WebAssembly (sql.js)    →  banco real, schema, índices, transações
server/sim     simulador da cidade (o "campo": IoT, agentes, ocorrências)
server/engine  motor do F.O.G.O. (risco, anomalias, Weibull, Húngaro, Voronoi, backtest)
web/           React + TypeScript + Leaflet (OpenStreetMap, sem chave de API), gráficos em SVG próprio`}</pre>
        <p>Segurança e robustez: todas as consultas são parametrizadas, a entrada é validada contra schema, o corpo das requisições é limitado, há proteção contra <i>path traversal</i> nos arquivos estáticos, escrita atômica do banco e auditoria de toda alteração. Se a internet cair, só o mapa de fundo deixa de carregar: regiões, equipamentos e previsões continuam funcionando.</p>

        <h2>Próximos passos (roadmap)</h2>
        <ul>
          <li>Autenticação com perfis (operador, gestor, manutenção) e permissões por órgão.</li>
          <li>Integração MQTT/LoRaWAN para telemetria real dos dispositivos.</li>
          <li>Roteamento sobre o grafo viário real (Dijkstra/A*) para o tempo de deslocamento dos agentes.</li>
          <li>Painel público de transparência (disponibilidade dos equipamentos por bairro).</li>
        </ul>
      </div>
    </div>
  );
}
