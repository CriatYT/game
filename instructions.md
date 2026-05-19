Eu tenho o arquivo index.html anexado. Ele contém a versão final do Front-End (HTML/CSS + Canvas) de um jogo de dedução social chamado "Corte de Mentiras" (estilo Coup, mas simplificado com 3 cartas). O visual, a estrutura do DOM, os botões e a renderização do Canvas a 60fps já estão 100% prontos e estilizados.

No entanto, o código atual possui Mockups (simulações locais de jogadores como "Renji", "Ayaka" e timeouts simulando rede).

SUA MISSÃO:
Substituir o Mockup por uma arquitetura Client-Server real usando Socket.io, implementando a lógica completa do jogo e gerenciamento de salas. Siga rigorosamente os passos abaixo em ordem:

1. Preparação e Infraestrutura (Backend)

Atualize o server.js, configurando um servidor HTTP básico que serve a pasta pública (onde o index.html vai ficar) e inicializa o Socket.io.

2. Sistema de Lobby e Salas (Front e Back)

Modificação no HTML (Botão Info): Adicione um botão "i" (Regras) na div #lobby-screen. Ao clicar, deve abrir um modal simples de HTML explicando os 3 papéis do jogo (Agiota: Pega 3 moedas, Matador: Paga 3 para matar, Segurança: Bloqueia assassinato).

Gerenciamento de Salas: Implemente a criação de salas com códigos únicos (ex: 4 letras maiúsculas).

Tela de Espera (Waiting Room): Quando um jogador cria ou entra na sala, a UI não deve pular direto para o Canvas. Crie uma "Tela de Espera" intermediária no HTML/CSS (com a mesma estética). Ela deve mostrar a lista de quem já entrou.

Botão Start: Apenas o Host (quem criou a sala) vê o botão "Iniciar Jogo" na tela de espera. O jogo só vai para o Canvas quando o host iniciar.

3. Remoção de Mocks e Renderização Dinâmica (Front-End)

Remova os mockups do index.html (jogadores "Renji" e "Ayaka" chumbados na variável gameState.players). O gameState deve nascer vazio e ser populado EXCLUSIVAMENTE pelo estado enviado pelo servidor via socket.on('update_state', ...).

Refatoração Geométrica: Modifique a função calcularPosicaoMesa(index, totalPlayers, isMe) no JS do cliente. O jogo deve suportar de 3 a 6 jogadores. A função deve calcular posições radiais ao redor do centro da mesa para evitar sobreposição (mantendo o jogador local sempre na base inferior da tela).

4. Game Engine Central (Backend)

O Deck: O servidor deve gerar o baralho contendo 5 cópias de cada papel (Agiota, Matador, Segurança). Total: 15 cartas. Ao iniciar a partida, embaralhe e distribua 2 cartas secretas para cada jogador.

A Economia: Inicie cada jogador com 2 moedas e um Banco Central (que guarda as moedas restantes).

Sistema de Turnos: O servidor controla de quem é a vez (variável currentPlayerId). Apenas esse jogador tem os botões do #painel-acoes habilitados no frontend.

Resolução de Ações (O Core Loop):

Jogador envia ação (Ex: "Agiota").

Servidor recebe e transmite para os OUTROS jogadores uma janela de desafio de 7 segundos.

No frontend dos adversários, mostra a tela #overlay-duvidar.

Se ninguém duvidar em 7s, o servidor executa a ação (Dá as 3 moedas para o jogador) e passa o turno.

Se alguém enviar evento "challenge" (Duvidar), o servidor cancela o cronômetro e inicia a Resolução de Conflito.

5. Resolução de Conflitos e Eliminação (Backend)

O servidor verifica as cartas do jogador que agiu.

Se MENTIU: Ele perde uma carta. O front é notificado para alterar a carta para isDead: true.

Se FALOU A VERDADE: O jogador que duvidou é punido e perde uma carta. O jogador que agiu tem a carta revelada, volta pro baralho, embaralha, pesca uma nova (para voltar a ficar oculta) e o efeito da ação (ex: pegar as moedas) acontece normalmente.

Condição de Vitória: Jogadores com 2 cartas mortas não jogam mais. Quando restar apenas 1 jogador com cartas vivas, o servidor emite o fim de jogo.