// Plain data: given names and surnames. No logic.
// Kept separate so the lists can grow without touching generator.ts.
//
// SURNAMES must stay longer than STARTER_WORKER_COUNT + 1 (the queen): each
// founder starts its own surname line (generator.ts's founderSurname), and a
// list shorter than the founder count would repeat surnames on day one.
// Appending is safe; REORDERING or removing entries changes every name the
// generator hands out, so existing colonies' saved names stop matching.

export const GIVEN_NAMES: readonly string[] = [
    "Alfie", "Archie", "Arthur", "Barney", "Basil", "Benny", "Bernie", "Billy", "Bobby", "Bodie",
    "Bo", "Bram", "Bruno", "Buddy", "Cal", "Carl", "Charlie", "Chester", "Chip", "Clyde",
    "Cody", "Colby", "Cosmo", "Crispin", "Curtis", "Dale", "Danny", "Darryl", "Dexter", "Dewey",
    "Dino", "Dobby", "Donny", "Doug", "Doyle", "Dudley", "Duncan", "Eddie", "Edwin", "Elmer",
    "Elliot", "Elmo", "Emmett", "Ernie", "Eugene", "Felix", "Finn", "Floyd", "Forrest", "Frank",
    "Freddie", "Fritz", "Gabe", "Garth", "Gary", "Gavin", "Geoff", "George", "Gerry", "Gilbert",
    "Gizmo", "Gordon", "Graham", "Grant", "Gus", "Harold", "Harry", "Harvey", "Hector", "Henry",
    "Herbert", "Herman", "Homer", "Howard", "Hubert", "Hugh", "Humphrey", "Ian", "Iggy", "Irving",
    "Jack", "Jackie", "Jasper", "Jeb", "Jeff", "Jerry", "Jesse", "Jimmy", "Joey", "Johnny",
    "Jonah", "Jules", "Julian", "Kenny", "Kevin", "Kirby", "Lance", "Larry", "Leo", "Leon",
    "Lenny", "Lester", "Levi", "Linus", "Lloyd", "Louie", "Louis", "Luca", "Lucky", "Mack",
    "Marty", "Marvin", "Mason", "Matty", "Maurice", "Max", "Melvin", "Mickey", "Milo", "Mitch",
    "Monty", "Morty", "Murray", "Ned", "Nelson", "Nico", "Nigel", "Norman", "Norris", "Oliver",
    "Ollie", "Orson", "Oscar", "Otis", "Otto", "Owen", "Parker", "Pat", "Patrick", "Paul",
    "Percy", "Pete", "Peter", "Phil", "Philip", "Pip", "Pippin", "Porter", "Quincy", "Ralph",
    "Randy", "Ray", "Reggie", "Remy", "Rex", "Riley", "Ringo", "Robbie", "Robin", "Rocky",
    "Rodney", "Roger", "Roland", "Rolly", "Ronnie", "Roscoe", "Roy", "Rudy", "Rupert", "Russell",
    "Sam", "Sammy", "Sandy", "Saul", "Scottie", "Sebastian", "Sid", "Simon", "Skip", "Smitty",
    "Spencer", "Stan", "Stanley", "Stevie", "Stu", "Stuart", "Tad", "Tanner", "Teddy", "Theo",
    "Theodore", "Timmy", "Toby", "Todd", "Tommy", "Tony", "Travis", "Trevor", "Tripp", "Truman",
    "Tucker", "Tully", "Tyler", "Vern", "Vernon", "Victor", "Vincent", "Wally", "Walter", "Warren",
    "Wes", "Wesley", "Wilbur", "Wiley", "Willy", "Wilson", "Winston", "Woody", "Wyatt", "Xavier",
    "Yogi", "Zack", "Ziggy", "Abby", "Aggie", "Alice", "Annie", "Bea", "Becky", "Betty",
    "Bonnie", "Bridget", "Callie", "Carly", "Carrie", "Cassie", "Cathy", "Cece", "Chloe", "Clara",
    "Cleo", "Cora", "Daisy", "Darla", "Dolly", "Dora", "Edie", "Effie", "Ellie", "Elsie",
    "Emily", "Emma", "Evie", "Fanny", "Flora", "Frannie", "Freya", "Gertie", "Gigi", "Gladys",
    "Goldie", "Gracie", "Greta", "Gwen", "Hattie", "Hazel", "Heidi", "Iris", "Ivy", "Janie",
    "Jenny", "Josie", "Judy", "Kitty", "Lacy", "Lana", "Lena", "Lily", "Lola", "Lucy",
    "Mabel", "Maisie", "Maggie", "Millie", "Minnie", "Molly", "Nancy", "Nellie", "Nora", "Olive",
    "Penny", "Polly", "Posie", "Rosie", "Ruby", "Sally", "Sophie", "Stella", "Susie", "Tilly"
]

export const SURNAMES: readonly string[] = [
    "Bac", "Tinyfeet", "Crumbwell", "Puddles", "Munch", "Wiggles", "Scurry", "Blip", "Pickles", "Gum",
    "Nibbles", "Doodle", "Beans", "Button", "Biscuit", "Duck", "Yuck", "Pebble", "Dusty", "Tumbles", 
    "Keys", "Crawley", "Stumbles", "Grubbs", "Buggs", "McTiny", "Footman", "Teenyson", "Wemberly", "Fizzlebottom", 
    "Winkle", "Pockett", "Thimble", "Tibbles", "Quibble", "Pips", "Wobbleton", "Dobbins", "Muddle", "Tinker",
    "Snodgrass", "Niblet", "Pumpernickel", "Figgins", "Wainscot", "Sprocket", "Wicket", "Featherstone", "Honeywell", "Dinglewood"
]