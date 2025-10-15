import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    onSnapshot, 
    addDoc, 
    doc, 
    setDoc, 
    getDocs, 
    getDoc,
    updateDoc, // Added for banning
    deleteDoc, // Added for deleting messages
    serverTimestamp 
} from 'firebase/firestore';

// Define global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-chat-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Whitelist of allowed usernames (Only first names from the provided list) ---
const ALLOWED_USERNAMES = new Set([
    "Nurai", "Zhaina", "Arsen", "Elenora", "Eldiar", "Jasir", "Aiperi", "Nazima", "Erzhan", "Nurdan", 
    "Baizhan", "Janbolot", "Iskender", "Kutman", "Daniel", "Dayirbek", "Aibiyke", "Jihyong", "Marlen", 
    "Mirana", "Vildan", "Shergazy", "Roman", "Aiman", "Nursultan", "Zhanybek", "Erbol", "Begaiym", 
    "Nurbek", "Diaz", "Kasymbek", "Adel", "Temirlan", "Meerim", "Bayastan", "Elina", "Belek", "Begimai", 
    "Emil", "Nazik", "Asylkan", "Altynai", "Nurbolot", "Abdusamat", "Aisha", "Abdunur", "Amin", 
    "Zarylkan", "Diliafruz", "Saadat", "Akylbek", "Rahat", "Iigilik", "Baiel", "Adelya", "Eldar", 
    "Aman", "Ilhan", "Adina", "Asel", "Bekbol", "Aiana", "Azho", "Akbar", "Emir", "Chyngyz", "Ibrahimbek",
    "Admin" // Added Admin name for registration access
].map(name => name.toLowerCase())); // Store in lowercase for case-insensitive check

// Helper to format time
const formatTime = (timestamp) => {
    if (!timestamp) return '...';
    // Handle Firestore Timestamp object
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Helper to check if a string is an image URL
const isImageUrl = (text) => {
    if (typeof text !== 'string') return false;
    return (text.match(/\.(jpeg|jpg|gif|png|webp|svg)$/) != null);
};

// Helper to check if a string is a YouTube URL
const isYouTubeUrl = (text) => {
    if (typeof text !== 'string') return false;
    return text.includes('youtube.com/') || text.includes('youtu.be/');
};

// Helper to check if a string is a video URL (mp4, webm etc.)
const isVideoUrl = (text) => {
    if (typeof text !== 'string') return false;
    return (text.match(/\.(mp4|webm|ogg)$/) != null);
};

// --- App Component ---
const App = () => {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [userId, setUserId] = useState(null); // Current logged-in user's custom UID
    const [username, setUsername] = useState('');
    const [isAdmin, setIsAdmin] = useState(false); // New admin state
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);

    // Chat Specific State
    const [view, setView] = useState('login'); // 'login', 'register', 'userList', 'chat', 'supportForm', 'supportDashboard'
    const [allUsers, setAllUsers] = useState([]);
    const [activeChatUser, setActiveChatUser] = useState(null); // { uid, username }
    const [messages, setMessages] = useState([]);
    const [newMessageText, setNewMessageText] = useState('');
    const [supportMessages, setSupportMessages] = useState([]); // State for admin dashboard

    const messagesEndRef = useRef(null);
    const usersCollectionPath = `/artifacts/${appId}/public/data/users`;
    const messagesCollectionPath = `/artifacts/${appId}/public/data/messages`;
    const supportCollectionPath = `/artifacts/${appId}/public/data/support_requests`; // New collection for support

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // 1. Initial Auth Check and Setup
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    // Check if the user is already registered in our 'users' collection
                    const userDocRef = doc(firestoreDb, usersCollectionPath, user.uid);
                    const userDocSnap = await getDoc(userDocRef);

                    if (userDocSnap.exists()) {
                        const userData = userDocSnap.data();
                        if (userData.isBanned) {
                            // User is banned - Sign out and show error
                            firebaseAuth.signOut();
                            showMessage("Вы были заблокированы администратором и не можете войти.");
                            return;
                        }

                        // User exists and is logged in
                        setUserId(user.uid);
                        setUsername(userData.username);
                        setIsAdmin(userData.isAdmin || false);
                        setView('userList');
                    } else if (user.isAnonymous) {
                         // Signed in anonymously, but we need to prompt for login/register
                        setUserId(null);
                        setView('login');
                    }
                } else {
                    // No user signed in, use initial token or sign in anonymously
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                }
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization failed:", e);
            setError("Ошибка инициализации Firebase. Проверьте конфигурацию.");
        }
    }, []);

    // --- User Management (Fetching All Users) ---
    useEffect(() => {
        if (!db || !userId || !isAuthReady || view === 'login' || view === 'register') return;

        const q = query(collection(db, usersCollectionPath));

        // Listen for real-time changes to the list of all registered users
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const usersList = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                if (doc.id !== userId) { // Exclude the current user
                    usersList.push({
                        uid: doc.id,
                        username: data.username,
                        isAdmin: data.isAdmin || false,
                        isBanned: data.isBanned || false, // Fetch ban status
                    });
                }
            });
            setAllUsers(usersList);
        }, (err) => {
            console.error("Error fetching users:", err);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady, view]);

    // --- Admin Dashboard (Fetching Support Messages) ---
    useEffect(() => {
        if (!db || !isAdmin || view !== 'supportDashboard') return;

        const q = query(collection(db, supportCollectionPath));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const messagesList = [];
            snapshot.forEach((doc) => {
                messagesList.push({ id: doc.id, ...doc.data() });
            });
            messagesList.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
            setSupportMessages(messagesList);
        }, (err) => {
            console.error("Error fetching support messages:", err);
        });

        return () => unsubscribe();
    }, [db, isAdmin, view]);


    // --- Chat Management (Fetching Messages) ---
    useEffect(() => {
        if (!db || !userId || !activeChatUser || view !== 'chat') return;

        const messagesRef = collection(db, messagesCollectionPath);

        // Query: Messages where the sender AND recipient are the two users involved in the chat.
        const q = query(
            messagesRef,
            where('senderId', 'in', [userId, activeChatUser.uid]),
            where('recipientId', 'in', [userId, activeChatUser.uid]),
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedMessages = [];
            snapshot.forEach((doc) => {
                fetchedMessages.push({ id: doc.id, ...doc.data() });
            });
            
            // Sort by timestamp client-side for correct order
            fetchedMessages.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(fetchedMessages);
        }, (err) => {
            console.error("Error fetching messages:", err);
        });

        return () => unsubscribe();
    }, [db, userId, activeChatUser, view]);
    
    // Scroll to bottom when messages update
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // --- Handlers ---
    const showMessage = (msg) => {
        setError(msg);
        setTimeout(() => setError(null), 5000);
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!username || !password) {
            showMessage("Пожалуйста, введите имя пользователя и пароль.");
            return;
        }
        
        const normalizedUsername = username.trim().toLowerCase();
        const isUserAdmin = normalizedUsername === 'admin'; 

        if (!ALLOWED_USERNAMES.has(normalizedUsername)) {
            showMessage(`Ошибка: Имя "${username}" не входит в список разрешенных пользователей.`);
            return;
        }

        try {
            const q = query(collection(db, usersCollectionPath), where('username', '==', username));
            const existingUsers = await getDocs(q);

            if (!existingUsers.empty) {
                showMessage("Это имя пользователя уже занято.");
                return;
            }

            // Create a pseudo-random UID for the new user document
            const tempUid = 'uid_' + Date.now() + Math.random().toString(36).substring(2, 9);
            const userDocRef = doc(db, usersCollectionPath, tempUid);
            
            await setDoc(userDocRef, {
                username: username,
                password: password, 
                createdAt: serverTimestamp(),
                isAdmin: isUserAdmin, 
                isBanned: false,
            });
            
            showMessage(`Успешная регистрация для ${username}! Пожалуйста, войдите.`);
            setView('login');

        } catch (err) {
            console.error("Registration error:", err);
            showMessage("Ошибка регистрации. Попробуйте снова.");
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!username || !password) {
            showMessage("Пожалуйста, введите имя пользователя и пароль.");
            return;
        }
        
        try {
            const q = query(collection(db, usersCollectionPath), where('username', '==', username));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                showMessage("Пользователь не найден.");
                return;
            }

            const userData = snapshot.docs[0].data();
            const userUid = snapshot.docs[0].id;

            if (userData.isBanned) {
                showMessage("Ваш аккаунт заблокирован администратором.");
                return;
            }

            if (userData.password !== password) {
                showMessage("Неверный пароль.");
                return;
            }

            setUserId(userUid);
            setUsername(userData.username);
            setIsAdmin(userData.isAdmin || false);
            
            showMessage(`Добро пожаловать, ${userData.username}!`);
            setView('userList');

        } catch (err) {
            console.error("Login error:", err);
            showMessage("Ошибка входа. Попробуйте снова.");
        }
    };
    
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (newMessageText.trim() === '' || !activeChatUser || !userId || !db) return;
        
        const text = newMessageText.trim();
        let messageType = 'text';

        if (isImageUrl(text)) {
            messageType = 'image';
        } else if (isYouTubeUrl(text) || isVideoUrl(text)) {
            messageType = 'video';
        }

        try {
            await addDoc(collection(db, messagesCollectionPath), {
                text: text,
                type: messageType,
                senderId: userId,
                senderName: username,
                recipientId: activeChatUser.uid,
                recipientName: activeChatUser.username,
                timestamp: serverTimestamp(),
            });
            setNewMessageText('');
        } catch (err) {
            console.error("Error sending message:", err);
            showMessage("Не удалось отправить сообщение.");
        }
    };

    const handleDeleteMessage = async (msgId) => {
        if (!isAdmin || !db) {
            showMessage("У вас нет прав администратора для удаления сообщений.");
            return;
        }
        // Using window.confirm as a temporary solution for in-iframe environment
        if (!window.confirm("Вы уверены, что хотите удалить это сообщение?")) return;

        try {
            const msgDocRef = doc(db, messagesCollectionPath, msgId);
            await deleteDoc(msgDocRef);
            showMessage("Сообщение успешно удалено.");
        } catch (err) {
            console.error("Error deleting message:", err);
            showMessage("Ошибка при удалении сообщения.");
        }
    };

    const handleBanUser = async (userToBan) => {
        if (!isAdmin || !db || userToBan.username.toLowerCase() === 'admin') {
            showMessage("У вас нет прав или вы не можете заблокировать другого администратора.");
            return;
        }
        
        const isBanning = !userToBan.isBanned; // Toggle state

        // Using window.confirm as a temporary solution for in-iframe environment
        if (!window.confirm(`Вы уверены, что хотите ${isBanning ? 'ЗАБЛОКИРОВАТЬ' : 'РАЗБЛОКИРОВАТЬ'} пользователя ${userToBan.username}?`)) return;

        try {
            const userDocRef = doc(db, usersCollectionPath, userToBan.uid);
            await updateDoc(userDocRef, {
                isBanned: isBanning,
            });
            showMessage(`Пользователь ${userToBan.username} ${isBanning ? 'заблокирован' : 'разблокирован'}.`);
        } catch (err) {
            console.error("Error banning user:", err);
            showMessage("Ошибка при изменении статуса блокировки.");
        }
    };

    const handleSendSupportMessage = async (e, text) => {
        e.preventDefault();
        if (text.trim() === '' || !userId || !db) return;
        
        try {
            await addDoc(collection(db, supportCollectionPath), {
                text: text.trim(),
                senderId: userId,
                senderName: username,
                timestamp: serverTimestamp(),
            });
            showMessage("Ваше сообщение отправлено администратору.");
            setView('userList');
        } catch (err) {
            console.error("Error sending support message:", err);
            showMessage("Не удалось отправить сообщение в поддержку.");
        }
    };

    const handleDeleteSupportMessage = async (msgId) => {
        if (!isAdmin || !db) return;
        // Using window.confirm as a temporary solution for in-iframe environment
        if (!window.confirm("Удалить эту жалобу?")) return;

        try {
            const msgDocRef = doc(db, supportCollectionPath, msgId);
            await deleteDoc(msgDocRef);
            showMessage("Заметка поддержки удалена.");
        } catch (err) {
            console.error("Error deleting support message:", err);
            showMessage("Ошибка при удалении заметки поддержки.");
        }
    };

    const handleLogout = () => {
        auth.signOut();
        setUserId(null);
        setUsername('');
        setIsAdmin(false);
        setView('login');
    };

    // --- Media Renderer ---
    const MediaContent = ({ msg }) => {
        const url = msg.text;
        const widthClass = 'max-w-full rounded-lg shadow-md mt-1';
        
        // Helper to extract YouTube video ID or use iframe
        if (msg.type === 'video' && isYouTubeUrl(url)) {
            let videoId = '';
            try {
                const urlObj = new URL(url);
                if (urlObj.hostname.includes('youtube.com')) {
                    videoId = urlObj.searchParams.get('v');
                } else if (urlObj.hostname.includes('youtu.be')) {
                    videoId = urlObj.pathname.substring(1);
                }
            } catch (e) {
                // Ignore parsing errors for non-strict URLs
            }

            if (videoId) {
                return (
                    <div className="aspect-w-16 aspect-h-9 w-full">
                        <iframe
                            className={widthClass}
                            src={`https://www.youtube.com/embed/${videoId}`}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            title="YouTube video player"
                            style={{ height: '200px', width: '100%' }}
                        />
                    </div>
                );
            }
        }
        
        if (msg.type === 'image') {
            return (
                <img 
                    src={url} 
                    alt="Отправленное изображение" 
                    className={widthClass} 
                    style={{ maxHeight: '300px', objectFit: 'contain' }}
                    onError={(e) => e.target.src = "https://placehold.co/400x200/FF5733/FFFFFF?text=Ошибка+загрузки+изображения"}
                />
            );
        }

        if (msg.type === 'video' && isVideoUrl(url)) {
             return (
                <video controls className={widthClass} style={{ maxHeight: '300px', width: '100%' }}>
                    <source src={url} type="video/mp4" onError={(e) => showMessage("Ошибка загрузки видеофайла.")} />
                    Ваш браузер не поддерживает видео тег.
                </video>
            );
        }

        // Fallback to text if media rendering failed or if it was just a plain text/unsupported URL
        return <p className="text-base break-words">{url}</p>;
    };

    // --- Render Functions ---
    const renderAuth = (type) => (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 p-4">
            <div className="w-full max-w-md p-6 sm:p-8 space-y-6 bg-gray-800 rounded-xl shadow-2xl">
                <h2 className="text-3xl font-bold text-center text-white">
                    {type === 'login' ? 'Вход в Чат' : 'Регистрация'}
                </h2>
                {type === 'register' && (
                     <p className="text-sm text-center text-yellow-400">
                        *Для регистрации используйте только разрешенные имена (без фамилий) из списка, включая **Admin**.
                    </p>
                )}
                {error && (
                    <div className="p-3 text-sm text-red-100 bg-red-600 rounded-lg animate-pulse">
                        {error}
                    </div>
                )}
                <form onSubmit={type === 'login' ? handleLogin : handleRegister} className="space-y-4">
                    <div>
                        <input
                            type="text"
                            placeholder="Имя пользователя (Nickname)"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-4 py-3 text-white bg-gray-700 border border-gray-600 rounded-lg focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                        />
                    </div>
                    <div>
                        <input
                            type="password"
                            placeholder="Пароль"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-3 text-white bg-gray-700 border border-gray-600 rounded-lg focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full py-3 text-lg font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition duration-200 shadow-lg shadow-blue-500/50"
                    >
                        {type === 'login' ? 'Войти' : 'Зарегистрироваться'}
                    </button>
                </form>
                <div className="text-center text-gray-400">
                    {type === 'login' ? (
                        <>
                            Нет аккаунта?{' '}
                            <button type="button" onClick={() => setView('register')} className="text-blue-400 hover:text-blue-300">
                                Регистрация
                            </button>
                        </>
                    ) : (
                        <>
                            Уже есть аккаунт?{' '}
                            <button type="button" onClick={() => setView('login')} className="text-blue-400 hover:text-blue-300">
                                Войти
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );

    const renderUserList = () => (
        <div className="flex flex-col h-screen bg-gray-900">
            {/* Header with Navigation */}
            <header className="p-4 bg-gray-800 shadow-md flex justify-between items-center">
                <div className="flex flex-col">
                    <h1 className="text-xl font-bold text-white">
                        Привет, {username}! 
                        {isAdmin && <span className="text-red-400 font-extrabold ml-2">(Администратор)</span>}
                    </h1>
                    <p className="text-sm text-gray-400">Ваш ID: {userId}</p>
                </div>
                <button 
                    onClick={handleLogout}
                    className="p-2 text-sm text-red-400 border border-red-400 rounded-lg hover:bg-red-900 transition duration-150"
                >
                    Выход
                </button>
            </header>
            
            {/* Navigation Tabs */}
            <div className="flex justify-around bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
                <TabButton currentView={view} targetView="userList" label="Чат" setView={setView} />
                {isAdmin && <TabButton currentView={view} targetView="supportDashboard" label="Панель Админа" setView={setView} />}
                {!isAdmin && <TabButton currentView={view} targetView="supportForm" label="Поддержка" setView={setView} />}
            </div>

            {/* Main Content Area */}
            {view === 'userList' && (
                <main className="flex-grow p-4 overflow-y-auto">
                    {error && (
                        <div className="p-3 mb-4 text-sm text-red-100 bg-red-600 rounded-lg">
                            {error}
                        </div>
                    )}
                    <h2 className="text-xl font-semibold mb-4 text-gray-300">
                        Список пользователей ({allUsers.length})
                    </h2>
                    {allUsers.length === 0 ? (
                        <p className="text-gray-500">Пока нет других пользователей.</p>
                    ) : (
                        <div className="space-y-3">
                            {allUsers.map((user) => (
                                <div key={user.uid} className={`p-4 bg-gray-700 rounded-lg shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center ${user.isBanned ? 'border-2 border-red-500 opacity-60' : ''}`}>
                                    
                                    <button
                                        onClick={() => { setActiveChatUser(user); setView('chat'); }}
                                        className="text-left w-full sm:w-auto flex-grow"
                                    >
                                        <span className="text-lg font-medium text-white block">
                                            {user.username}
                                            {user.isAdmin && <span className="text-red-400 text-sm ml-2">(Админ)</span>}
                                            {user.isBanned && <span className="text-red-500 text-sm font-bold ml-2">(БАН)</span>}
                                        </span>
                                        <span className="text-xs text-gray-400 block sm:hidden">ID: {user.uid}</span>
                                    </button>

                                    {/* Admin Controls */}
                                    {isAdmin && (
                                        <div className="mt-2 sm:mt-0 flex space-x-2">
                                            <button
                                                onClick={() => handleBanUser(user)}
                                                className={`py-1 px-3 text-sm rounded-lg transition duration-150 
                                                            ${user.isBanned 
                                                                ? 'bg-green-600 hover:bg-green-700 text-white' 
                                                                : 'bg-red-600 hover:bg-red-700 text-white'}`}
                                            >
                                                {user.isBanned ? 'Разблокировать' : 'Заблокировать'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            )}

            {view === 'supportDashboard' && isAdmin && (
                <SupportDashboard 
                    messages={supportMessages} 
                    onDelete={handleDeleteSupportMessage}
                    error={error}
                />
            )}
             {view === 'supportForm' && !isAdmin && (
                <SupportForm 
                    onSend={handleSendSupportMessage} 
                    error={error}
                />
            )}
        </div>
    );
    
    const renderChat = () => (
        <div className="flex flex-col h-screen bg-gray-900">
            {/* Chat Header */}
            <header className="p-4 bg-gray-800 shadow-lg flex items-center">
                <button 
                    onClick={() => { setActiveChatUser(null); setView('userList'); }}
                    className="p-2 text-blue-400 hover:text-blue-300 mr-4 rounded-full bg-gray-700 transition duration-150"
                    title="Назад к списку пользователей"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <div className="flex flex-col">
                    <h2 className="text-xl font-bold text-white">Чат с {activeChatUser.username}</h2>
                    <p className="text-xs text-gray-500">ID: {activeChatUser.uid.substring(0, 8)}...</p>
                </div>
            </header>

            {/* Message Area */}
            <main className="flex-grow p-4 overflow-y-auto space-y-4">
                 {error && (
                    <div className="p-3 mb-4 text-sm text-red-100 bg-red-600 rounded-lg">
                        {error}
                    </div>
                )}
                {messages.length === 0 ? (
                    <div className="text-center py-10 text-gray-500">
                        Отправьте первое сообщение, чтобы начать разговор.
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isSender = msg.senderId === userId;
                        const bubbleClass = isSender ? 'bg-blue-600 text-white ml-auto' : 'bg-gray-700 text-gray-100 mr-auto';

                        return (
                            <div key={msg.id} className={`flex ${isSender ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] sm:max-w-md p-3 rounded-xl shadow-lg flex flex-col ${bubbleClass}`}>
                                    <div className="text-xs font-semibold mb-1 opacity-75">
                                        От: {msg.senderName} &rarr; Кому: {msg.recipientName}
                                    </div>
                                    
                                    {/* Media/Text Content */}
                                    <MediaContent msg={msg} />
                                    
                                    <div className={`text-xs mt-1 flex justify-between items-center ${isSender ? 'text-blue-200' : 'text-gray-400'} pt-1 border-t border-opacity-20 border-current`}>
                                        <span>{formatTime(msg.timestamp)}</span>
                                        {/* Admin Delete Button */}
                                        {isAdmin && (
                                            <button 
                                                onClick={() => handleDeleteMessage(msg.id)}
                                                className="ml-2 text-xs text-red-300 hover:text-red-100"
                                                title="Удалить сообщение (Админ)"
                                            >
                                                &#10005;
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </main>

            {/* Message Input */}
            <footer className="p-4 bg-gray-800 shadow-inner">
                <form onSubmit={handleSendMessage} className="flex space-x-3">
                    <input
                        type="text"
                        placeholder="Введите сообщение или URL (фото/видео)..."
                        value={newMessageText}
                        onChange={(e) => setNewMessageText(e.target.value)}
                        className="flex-grow px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-full focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                    />
                    <button
                        type="submit"
                        disabled={newMessageText.trim() === ''}
                        className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition duration-200 disabled:bg-gray-600 disabled:opacity-50"
                        title="Отправить"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </form>
            </footer>
        </div>
    );
    
    // --- Components for Navigation and Support ---
    
    const TabButton = ({ currentView, targetView, label, setView }) => (
        <button
            onClick={() => setView(targetView)}
            className={`py-3 px-4 font-medium transition duration-150 ${
                currentView === targetView 
                    ? 'text-white border-b-2 border-blue-500' 
                    : 'text-gray-400 hover:text-gray-200'
            }`}
        >
            {label}
        </button>
    );

    const SupportForm = ({ onSend, error }) => {
        const [text, setText] = useState('');
        return (
            <main className="flex-grow p-4 overflow-y-auto bg-gray-900">
                <h2 className="text-2xl font-bold text-white mb-4">Обращение в Поддержку</h2>
                 {error && (
                    <div className="p-3 mb-4 text-sm text-red-100 bg-red-600 rounded-lg">
                        {error}
                    </div>
                )}
                <p className="text-gray-400 mb-6">
                    Напишите здесь свою жалобу, заметку или вопрос. Сообщение будет отправлено Администратору.
                </p>
                <form onSubmit={(e) => onSend(e, text)} className="flex flex-col space-y-4">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows="6"
                        placeholder="Ваше сообщение..."
                        className="w-full px-4 py-3 text-white bg-gray-700 border border-gray-600 rounded-lg focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                    />
                    <button
                        type="submit"
                        disabled={text.trim() === ''}
                        className="py-3 text-lg font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition duration-200 disabled:opacity-50"
                    >
                        Отправить Администратору
                    </button>
                </form>
            </main>
        );
    };

    const SupportDashboard = ({ messages, onDelete, error }) => (
        <main className="flex-grow p-4 overflow-y-auto">
            <h2 className="text-2xl font-bold text-white mb-4">Панель Админа: Запросы Поддержки</h2>
            {error && (
                <div className="p-3 mb-4 text-sm text-red-100 bg-red-600 rounded-lg">
                    {error}
                </div>
            )}
            {messages.length === 0 ? (
                <p className="text-gray-500">Нет активных запросов поддержки.</p>
            ) : (
                <div className="space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className="p-4 bg-gray-700 rounded-lg shadow-lg border-l-4 border-yellow-500 relative">
                            <button
                                onClick={() => onDelete(msg.id)}
                                className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-200 rounded-full"
                                title="Удалить заметку"
                            >
                                &#10005;
                            </button>
                            <p className="text-sm font-semibold text-yellow-400">От: {msg.senderName}</p>
                            <p className="text-xs text-gray-400 mb-2">ID: {msg.senderId.substring(0, 8)}... | Время: {formatTime(msg.timestamp)}</p>
                            <p className="text-white mt-2 break-words">{msg.text}</p>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );

    // --- Main Renderer ---
    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
                Загрузка аутентификации...
            </div>
        );
    }
    
    if (view === 'register') {
        return renderAuth('register');
    }

    if (view === 'login' || !userId) {
        return renderAuth('login');
    }

    if (view === 'userList' || view === 'supportDashboard' || view === 'supportForm') {
        return renderUserList();
    }
    
    if (view === 'chat' && activeChatUser) {
        return renderChat();
    }
    
    return renderAuth('login');
};

export default App;
